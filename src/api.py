"""API HTTP do agente.

    .venv/bin/uvicorn src.api:app --reload --port 8000

Rotas:
    GET  /api/health          estado do banco e do modelo
    GET  /api/schema          estrutura do banco, para o explorador
    GET  /api/concept?term=…  os códigos que um termo significa nesta base
    POST /api/concept/count   reconta quando o usuário muda a seleção
    GET  /api/ask?q=…         eventos do agente via SSE
    GET  /api/investigate?q=… investigação com várias consultas, via SSE

O SSE usa GET porque `EventSource` no navegador só faz GET. Cada evento é uma
linha `data: {...}` com o mesmo formato que o frontend já consome — o contrato
está em `frontend/src/lib/types.ts` (`StreamEvent`).
"""
from __future__ import annotations

import functools
import json
import logging
import queue
import threading
from collections.abc import Iterator

import yaml
from fastapi import Body, FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import concepts, roteador, websearch
from .paineis import Paineis, PainelInexistente
from .paineis import (
    catalogo as catalogo_painel,
    executar as executar_painel,
    gerar as gerar_widget,
    gerar_filtro,
    montar as montar_painel,
    planejar as planejar_painel,
    progresso as prog,
    rotear as rotear_painel,
)
from .investigation import Investigador
from .chats import ChatInexistente, Conversas, Rodada as RodadaChat
from .themes import (
    Armazem,
    Bloco,
    Definicao,
    TemaInexistente,
    contexto as ctx_tema,
    indice as ind_tema,
    resposta as resposta_tema,
)
from .agent import TextToSQLAgent, Turn
from .config import settings
from .db import Database

app = FastAPI(
    title="Consulta SIH/SUS",
    description="Perguntas em português sobre 144 milhões de internações do SUS.",
    version="1.0.0",
)

# ORDEM IMPORTA: este middleware é registrado ANTES do CORS, e `add_middleware`
# empilha do último para o primeiro — então o CORS fica POR FORA dele, e a
# resposta de erro daqui passa pelo CORS na saída.
#
# Sem isso, uma exceção não tratada sobe até a camada de erro do Starlette, que
# é a mais externa de todas: o 500 sai sem `access-control-allow-origin`, o
# navegador o bloqueia antes de o código ler o status, e a interface reporta
# "Failed to fetch". O sintoma aponta para rede quando a causa é uma linha de
# Python — foi assim que um painel salvo em formato antigo virou "backend fora
# do ar" na tela.
@app.middleware("http")
async def erro_com_cors(request: Request, chamar):
    try:
        return await chamar(request)
    except Exception as exc:  # noqa: BLE001
        logging.exception("erro não tratado em %s %s", request.method, request.url.path)
        # O texto vai junto: é ferramenta de análise rodando local, e esconder a
        # causa aqui custa mais do que expõe.
        return JSONResponse(
            {"error": f"{type(exc).__name__}: {exc}"[:500], "path": request.url.path},
            status_code=500,
        )


# O Vite serve em 5173; as portas alternativas cobrem o caso de a principal
# estar ocupada.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):(5173|5174|5175|4173)",
    # PATCH está aqui porque o ajuste de aparência do widget e o renomear do
    # painel o usam. Sem ele o preflight falha e a tela reporta "Failed to
    # fetch" — o mesmo sintoma de rede para uma causa que não é rede.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

_db: Database | None = None
_agent: TextToSQLAgent | None = None


def agente() -> TextToSQLAgent:
    """Instância única. Abrir o DuckDB de 15 GB a cada requisição seria absurdo."""
    global _db, _agent
    if _agent is None:
        _db = Database()
        _agent = TextToSQLAgent(db=_db)
    return _agent


_investigador: Investigador | None = None


def investigador() -> Investigador:
    """Reusa o mesmo agente do /api/ask — mesma conexão, mesmo dicionário."""
    global _investigador
    if _investigador is None:
        _investigador = Investigador(agente())
    return _investigador


_armazem: Armazem | None = None


def armazem() -> Armazem:
    global _armazem
    if _armazem is None:
        _armazem = Armazem()
    return _armazem


_conversas: Conversas | None = None


def conversas() -> Conversas:
    global _conversas
    if _conversas is None:
        _conversas = Conversas()
    return _conversas


def sse(evento: dict) -> str:
    return f"data: {json.dumps(evento, ensure_ascii=False)}\n\n"


@app.get("/api/health")
def health() -> JSONResponse:
    try:
        n = agente().db.run("SELECT count(*) FROM internacoes", add_limit=False).rows[0][0]
        return JSONResponse(
            {
                "ok": True,
                "internacoes": n,
                "model": settings.sql_model,
                "database": agente().db.path.rsplit("/", 1)[-1],
            }
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)


@functools.lru_cache(maxsize=1)
def _schema_payload() -> dict:
    """Monta a estrutura do banco a partir do dicionário curado + contagens reais.

    Em cache: o conteúdo só muda se o YAML ou o banco mudarem, e ambos são
    estáticos durante a execução do servidor.
    """
    db = agente().db
    doc = yaml.safe_load(open(settings.schema_file, encoding="utf-8"))
    vazias = {"hospital", "socioeconomico"}
    proibidas = {"_staging_internacoes"}

    def colunas_do_banco(nome: str) -> list[dict]:
        try:
            r = db.run(
                "SELECT column_name, data_type FROM information_schema.columns "
                f"WHERE table_schema='main' AND table_name='{nome}' ORDER BY ordinal_position",
                validate=False,
                add_limit=False,
            )
            return [{"name": c, "type": t, "desc": ""} for c, t in r.rows]
        except Exception:
            return []

    def linhas(nome: str, padrao: int = 0) -> int:
        try:
            return int(db.run(f'SELECT count(*) FROM "{nome}"', validate=False, add_limit=False).rows[0][0])
        except Exception:
            return padrao

    tabelas = []
    for nome, spec in doc["tables"].items():
        cols = [
            {"name": c, "type": m.get("type", ""), "desc": m.get("desc", "")}
            if isinstance(m, dict)
            else {"name": c, "type": "", "desc": str(m)}
            for c, m in (spec.get("columns") or {}).items()
        ]
        if not cols:
            cols = colunas_do_banco(nome)
        tabelas.append(
            {
                "name": nome,
                "role": spec.get("role", "dimensao"),
                "rows": linhas(nome, spec.get("rows", 0)),
                "description": (spec.get("description") or spec.get("grain") or "").strip(),
                "caveat": (spec.get("caveat") or "").strip() or None,
                "empty": nome in vazias,
                "forbidden": nome in proibidas,
                "columns": cols,
                "domain": {str(k): v for k, v in spec["values"].items()} if spec.get("values") else None,
            }
        )

    for nome, motivo in doc.get("forbidden_tables", {}).items():
        if any(t["name"] == nome for t in tabelas):
            continue
        n = linhas(nome)
        tabelas.append(
            {
                "name": nome,
                "role": "indisponivel",
                "rows": n,
                "description": motivo,
                "caveat": None,
                "empty": n == 0,
                "forbidden": nome in proibidas,
                "columns": colunas_do_banco(nome),
                "domain": None,
            }
        )

    tabelas.sort(key=lambda t: (t["role"] != "fato", -t["rows"]))
    return {
        "tables": tabelas,
        "rules": [
            {"id": r["id"], "severity": r["severity"], "text": r["text"].strip()}
            for r in doc["rules"]
        ],
        "period": doc["database"]["period"].strip(),
        "grain": doc["database"]["grain"].strip(),
    }


@app.get("/api/schema")
def schema() -> JSONResponse:
    return JSONResponse(_schema_payload())


@app.get("/api/concept")
def concept(
    term: str = Query(..., min_length=3, max_length=60, description="Termo clínico"),
) -> JSONResponse:
    """Resolve um termo nos códigos que ele significa nesta base.

    Existe porque o agente erra a DEFINIÇÃO com mais frequência do que erra SQL,
    e o erro de definição sai plausível: "covid" em U07 devolve zero, "parto" em
    um único procedimento perde 1,19 milhão de partos.
    """
    return JSONResponse(concepts.para_json(concepts.resolve(agente().db, term)))


@app.post("/api/concept/count")
def concept_count(selecao: list[dict] = Body(..., embed=False)) -> JSONResponse:
    """Reconta ao vivo quando o usuário muda a seleção.

    Sem isto o painel teria de SOMAR os candidatos marcados — e somar
    procedimento com diagnóstico conta a mesma internação duas vezes: para
    "parto" a soma dá 43.564.593 onde a união é 25.010.349. O número mostrado
    tem de vir de uma contagem, sempre.
    """
    total = concepts.contar(agente().db, concepts.de_json(selecao))
    return JSONResponse({"total": total})


# ---- busca em fontes confiáveis -------------------------------------------


@app.get("/api/search")
def buscar(
    q: str = Query(..., min_length=3, max_length=300, description="O que procurar"),
) -> JSONResponse:
    """Busca restrita à lista branca e devolve CANDIDATOS, não respostas.

    A escolha é humana: o candidato escolhido preenche o mesmo formulário de
    fonte externa que já existe, com o trecho literal e a URL. Nada daqui entra
    no prompt que gera SQL — a barreira está em themes/contexto.py.
    """
    try:
        return JSONResponse(websearch.buscar(q).para_json())
    except websearch.BuscaIndisponivel as exc:
        # 503 e não 500: a busca é um extra: sem ela o resto do produto funciona.
        return JSONResponse({"error": str(exc)}, status_code=503)


@app.get("/api/search/status")
def status_busca() -> JSONResponse:
    """Se a interface deve oferecer a busca, e em quais domínios."""
    return JSONResponse(
        {"available": websearch.disponivel(), "domains": websearch.dominios_ativos()}
    )


# ---- conversas salvas -----------------------------------------------------
#
# O chat é RASCUNHO: salvo para você poder voltar, não para acumular. Quem fecha
# a aba sem querer deixou de perder a conversa — só isso. A conversa salva NÃO
# vira contexto de outra conversa; essa propriedade é do tema.


@app.get("/api/chats")
def listar_chats() -> JSONResponse:
    return JSONResponse([c.para_json(com_rodadas=False) for c in conversas().listar()])


@app.post("/api/chats")
def criar_chat() -> JSONResponse:
    return JSONResponse(conversas().criar().para_json(), status_code=201)


@app.get("/api/chats/{chat_id}")
def ler_chat(chat_id: str) -> JSONResponse:
    try:
        return JSONResponse(conversas().ler(chat_id).para_json())
    except ChatInexistente:
        return JSONResponse({"error": "Conversa não encontrada."}, status_code=404)


@app.post("/api/chats/{chat_id}/turns")
def acrescentar_rodada(chat_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Salva uma rodada assim que ela termina.

    Incremental e não ao fechar a aba: quem fecha não avisa antes, e é
    justamente aí que a conversa se perderia.
    """
    try:
        chat = conversas().acrescentar(chat_id, RodadaChat.de_json(corpo))
        return JSONResponse(chat.para_json(com_rodadas=False), status_code=201)
    except ChatInexistente:
        return JSONResponse({"error": "Conversa não encontrada."}, status_code=404)


@app.delete("/api/chats/{chat_id}")
def apagar_chat(chat_id: str) -> JSONResponse:
    conversas().apagar(chat_id)
    return JSONResponse({"ok": True})


# ---- temas de investigação ------------------------------------------------
#
# Um tema é um espaço que acumula evidência sobre um assunto. Fica no servidor,
# não no navegador, porque o chat do tema precisa dos blocos no prompt e subir
# tabelas inteiras a cada pergunta seria absurdo — além de o tema sobreviver a
# limpar o navegador e virar compartilhável por URL.


@app.get("/api/themes")
def listar_temas() -> JSONResponse:
    """Só os metadados: a lista não precisa carregar as tabelas de cada bloco."""
    return JSONResponse([t.para_json(com_blocos=False) for t in armazem().listar()])


@app.post("/api/themes")
def criar_tema(corpo: dict = Body(default_factory=dict)) -> JSONResponse:
    tema = armazem().criar(
        titulo=str(corpo.get("title") or ""), descricao=str(corpo.get("description") or "")
    )
    return JSONResponse(tema.para_json(), status_code=201)


@app.get("/api/themes/{tema_id}")
def ler_tema(tema_id: str) -> JSONResponse:
    try:
        return JSONResponse(armazem().ler(tema_id).para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/rename")
def renomear_tema(tema_id: str, corpo: dict = Body(...)) -> JSONResponse:
    try:
        tema = armazem().renomear(
            tema_id, str(corpo.get("title") or ""), corpo.get("description")
        )
        return JSONResponse(tema.para_json(com_blocos=False))
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.delete("/api/themes/{tema_id}")
def apagar_tema(tema_id: str) -> JSONResponse:
    armazem().apagar(tema_id)
    return JSONResponse({"ok": True})


@app.post("/api/themes/{tema_id}/blocks")
def fixar_bloco(tema_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Fixa um bloco vindo do chat ou de um relatório de investigação."""
    try:
        tema = armazem().fixar(tema_id, Bloco.de_json(corpo))
        return JSONResponse(tema.para_json(), status_code=201)
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.delete("/api/themes/{tema_id}/blocks/{bloco_id}")
def desafixar_bloco(tema_id: str, bloco_id: str) -> JSONResponse:
    try:
        return JSONResponse(armazem().desafixar(tema_id, bloco_id).para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/blocks/{bloco_id}/note")
def anotar_bloco(tema_id: str, bloco_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """A anotação é o que transforma uma coleção de consultas numa investigação."""
    try:
        tema = armazem().anotar(tema_id, bloco_id, str(corpo.get("note") or ""))
        return JSONResponse(tema.para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/threads")
def criar_fio(tema_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Uma linha de investigação dentro do tema."""
    try:
        tema = armazem().criar_fio(tema_id, str(corpo.get("title") or ""), str(corpo.get("summary") or ""))
        return JSONResponse(tema.para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.patch("/api/themes/{tema_id}/threads/{fio_id}")
def editar_fio(tema_id: str, fio_id: str, corpo: dict = Body(...)) -> JSONResponse:
    try:
        return JSONResponse(armazem().editar_fio(tema_id, fio_id, corpo).para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.delete("/api/themes/{tema_id}/threads/{fio_id}")
def apagar_fio(tema_id: str, fio_id: str) -> JSONResponse:
    """Apaga o fio e solta os achados dele — nunca os apaga junto."""
    try:
        return JSONResponse(armazem().apagar_fio(tema_id, fio_id).para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.patch("/api/themes/{tema_id}/blocks/{bloco_id}")
def classificar_bloco(tema_id: str, bloco_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """O papel do achado no argumento: sustenta, contradiz ou contextualiza.

    Separado de `/layout` porque são coisas de naturezas diferentes: layout é
    apresentação e pode ser mexido sem consequência, classificação é uma
    afirmação sobre o que a evidência prova — e é ela que alimenta a contagem de
    contradições e a conta de apoio de uma resposta.
    """
    try:
        return JSONResponse(armazem().classificar(tema_id, bloco_id, corpo).para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/blocks/{bloco_id}/layout")
def ajustar_bloco(tema_id: str, bloco_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Formato e tamanho do bloco no painel."""
    try:
        tema = armazem().formatar(
            tema_id,
            bloco_id,
            formato=corpo.get("format"),
            largura=corpo.get("width"),
            altura=corpo.get("height"),
        )
        return JSONResponse(tema.para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/palette")
def pintar_tema(tema_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Paleta própria do tema. String vazia volta para a paleta do site."""
    try:
        tema = armazem().pintar(tema_id, str(corpo.get("palette") or ""))
        return JSONResponse(tema.para_json(com_blocos=False))
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/grid")
def dispor_grade(tema_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """A grade inteira: posição e tamanho de cada bloco, de uma vez só."""
    try:
        tema = armazem().dispor(tema_id, list(corpo.get("layout") or []))
        return JSONResponse(tema.para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/reorder")
def reordenar_blocos(tema_id: str, corpo: dict = Body(...)) -> JSONResponse:
    try:
        tema = armazem().reordenar(tema_id, [str(x) for x in (corpo.get("order") or [])])
        return JSONResponse(tema.para_json())
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.post("/api/themes/{tema_id}/definitions")
def definir_termo(tema_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """A definição vale para o tema inteiro — é o que a torna útil."""
    try:
        tema = armazem().definir(tema_id, Definicao.de_json(corpo))
        return JSONResponse(tema.para_json(com_blocos=False), status_code=201)
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.delete("/api/themes/{tema_id}/definitions/{termo}")
def remover_definicao(tema_id: str, termo: str) -> JSONResponse:
    try:
        return JSONResponse(armazem().remover_definicao(tema_id, termo).para_json(com_blocos=False))
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)


@app.get("/api/themes/{tema_id}/ask")
def perguntar_no_tema(
    tema_id: str,
    q: str = Query(..., min_length=2, max_length=2000),
    history: str | None = Query(None),
) -> StreamingResponse:
    """Pergunta feita DENTRO de um tema, com os blocos já fixados como contexto.

    É o que separa um tema de uma pasta: sem isto os blocos são arquivos
    guardados; com isto, "compare com o gráfico de sexo que já está aqui"
    funciona, porque o modelo sabe o que já foi apurado.

    Aqui — e só aqui — a pergunta passa antes por um roteador: "busque na
    internet quantos mortos a covid teve" tem de virar busca, não SQL. Ver
    src/roteador.py. O /api/ask normal, que é o caminho da avaliação, não tem
    esse passo.

    O contexto vai só para a geração de SQL — nunca para a redação da resposta.
    Ver src/themes/contexto.py para o porquê.
    """
    try:
        tema = armazem().ler(tema_id)
    except TemaInexistente:
        return JSONResponse({"error": "Tema não encontrado."}, status_code=404)

    turnos: list[Turn] = []
    if history:
        try:
            turnos = [
                Turn(question=h["question"], sql=h.get("sql"))
                for h in json.loads(history)
                if h.get("question")
            ]
        except Exception:
            turnos = []

    contexto = ctx_tema.montar(tema)

    def fluxo() -> Iterator[str]:
        try:
            rota = roteador.rotear(
                q, assunto=tema.titulo, catalogo=ind_tema.indexar(tema)
            )
            yield sse({"type": "route", **rota.para_json()})

            # O TEMA COMO FONTE. Antes de consultar o banco: se a resposta já
            # está num bloco fixado, reconsultar varreria 144 milhões de linhas
            # para reproduzir um número que está na tela.
            #
            # A recusa é o que torna isso seguro. `respondeu=False` devolve a
            # pergunta ao banco em vez de espremer uma resposta do material
            # errado — ver src/themes/resposta.py.
            if rota.usa_tema:
                # Panorama usa o tema inteiro: explicar a investigação com três
                # blocos escolhidos a dedo descreveria outra investigação.
                escolhidos = (
                    tema.blocos
                    if rota.escopo == "panorama"
                    else [b for b in tema.blocos if b.id in rota.blocos]
                )
                do_tema = resposta_tema.responder(
                    q, escolhidos, assunto=tema.titulo, escopo=rota.escopo
                )
                if do_tema.respondeu:
                    yield sse({"type": "theme_answer", **do_tema.para_json()})
                    yield sse({"type": "token", "text": do_tema.texto})
                    yield sse({"type": "done"})
                    return
                yield sse({"type": "theme_miss", "reason": do_tema.motivo})

            if rota.usa_web:
                # Primeiro a busca: ela leva segundos e a consulta leva dezenas,
                # então em "ambos" a tela já tem o que mostrar enquanto o SQL roda.
                try:
                    achados = websearch.buscar(rota.consulta_web)
                    yield sse({"type": "search", **achados.para_json()})
                except websearch.BuscaIndisponivel as exc:
                    yield sse({"type": "search_failed", "message": str(exc)})

            if rota.usa_banco or rota.usa_tema:
                # Em "ambos", vai só a metade que o SIH responde. Mandar a
                # pergunta inteira faz o gerador de SQL recusar por causa da
                # outra metade — e aí se perde também o número que ele daria.
                for evento in agente().ask_stream(
                    rota.para_o_banco(q), turnos, contexto_tema=contexto
                ):
                    yield sse(evento)
            else:
                # Os candidatos NÃO viram texto redigido. Um resumo de páginas
                # de terceiros seria um parágrafo sem fonte única, impossível de
                # conferir — e o canal por onde uma página injetaria instrução.
                # O que a tela mostra é trecho, domínio e link.
                yield sse({"type": "done"})
        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "failure", "kind": "rede", "message": f"Erro: {exc}"})
            yield sse({"type": "done"})

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------- painéis
_paineis: Paineis | None = None


def paineis() -> Paineis:
    global _paineis
    if _paineis is None:
        _paineis = Paineis()
    return _paineis


@app.get("/api/dashboards")
def listar_paineis() -> JSONResponse:
    return JSONResponse([p.para_json(com_widgets=False) for p in paineis().listar()])


@app.post("/api/dashboards")
def criar_painel(corpo: dict = Body(default={})) -> JSONResponse:
    return JSONResponse(paineis().criar(str(corpo.get("title") or "")).para_json())


@app.get("/api/dashboards/catalog")
def catalogo_do_painel() -> JSONResponse:
    """Os campos, medidas e formas que o menu manual oferece.

    Registrado ANTES de `/{painel_id}`: o FastAPI casa as rotas na ordem em que
    foram declaradas, e depois dela "catalog" viraria um id de painel.

    É uma constante — nada de banco no caminho —, então o cliente pode guardá-la
    e o menu abre sem esperar rede.
    """
    return JSONResponse(catalogo_painel.para_json())


@app.get("/api/dashboards/{painel_id}")
def ler_painel(painel_id: str) -> JSONResponse:
    try:
        return JSONResponse(paineis().ler(painel_id).para_json())
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)


@app.patch("/api/dashboards/{painel_id}")
def renomear_painel(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    try:
        return JSONResponse(paineis().renomear(painel_id, str(corpo.get("title") or "")).para_json())
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)


@app.delete("/api/dashboards/{painel_id}")
def apagar_painel(painel_id: str) -> JSONResponse:
    paineis().apagar(painel_id)
    return JSONResponse({"ok": True})


@app.post("/api/dashboards/{painel_id}/ask")
def pedir_ao_painel(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """A caixa do painel: um pedido vira widget ou filtro, conforme a intenção.

    Existe para a pessoa não ter de saber de antemão em qual categoria o pedido
    dela cai. "Quero ver só mulheres" é filtro; "um gráfico por sexo" é widget;
    a fronteira é sutil e não é trabalho de quem usa.
    """
    pedido = str(corpo.get("request") or "").strip()
    if len(pedido) < 3:
        return JSONResponse({"error": "Pedido muito curto."}, status_code=400)
    try:
        paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)

    alvo, motivo = rotear_painel.rotear(pedido)
    if alvo == "analise":
        # A análise não CRIA nada aqui: devolve o plano, e quem enfileira os
        # itens é a tela. Assim cada item aparece como uma tarefa própria, com
        # o seu próprio sucesso ou recusa — em vez de uma chamada de três
        # minutos que ou traz doze widgets ou não traz nenhum.
        plano = planejar_painel.planejar(pedido)
        return JSONResponse({"kind": "analise", "reason": motivo, **plano.para_json()})

    if alvo == "filtro":
        atual = paineis().ler(painel_id)
        catalogo = "\n".join(f"- {w.id} | {w.titulo}" for w in atual.widgets)
        r = gerar_filtro.gerar(pedido, agente().db, catalogo)
        if r.filtro is None:
            return JSONResponse({"kind": "filtro", "refused": r.recusa, "reason": motivo})
        painel = paineis().acrescentar_filtro(painel_id, r.filtro)
        # "Aplique só no gráfico X": a restrição vive nos widgets, não no
        # filtro — assim um widget novo nasce obedecendo, que é o padrão certo.
        validos = [w for w in r.apenas if atual.widget(w) is not None]
        if validos:
            painel = paineis().restringir_filtro(painel_id, r.filtro.id, validos)
        return JSONResponse(
            {"kind": "filtro", "refused": "", "reason": motivo,
             "dashboard": painel.para_json(), "createdId": r.filtro.id}
        )

    rw = gerar_widget.gerar(pedido, agente().db)
    if rw.widget is None:
        return JSONResponse({"kind": "widget", "refused": rw.recusa, "reason": motivo})
    painel = paineis().acrescentar(painel_id, rw.widget)
    return JSONResponse(
        {"kind": "widget", "refused": "", "reason": motivo,
         "dashboard": painel.para_json(), "createdId": rw.widget.id}
    )


@app.post("/api/dashboards/{painel_id}/widgets")
def criar_widget(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Monta um widget a partir de uma pergunta em linguagem natural.

    A recusa é resposta legítima e vem com o motivo: um widget que só falha
    quando alguém mexe no filtro é pior que um widget que nunca foi criado.
    """
    pergunta = str(corpo.get("question") or "").strip()
    if len(pergunta) < 3:
        return JSONResponse({"error": "Pergunta muito curta."}, status_code=400)
    try:
        paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)

    r = gerar_widget.gerar(pergunta, agente().db)
    if r.widget is None:
        return JSONResponse({"refused": r.recusa}, status_code=200)
    painel = paineis().acrescentar(painel_id, r.widget)
    return JSONResponse({"refused": "", "dashboard": painel.para_json(), "widgetId": r.widget.id})


def _com_relato(trabalho) -> Iterator[str]:
    """Roda `trabalho(relatar)` numa thread e transmite os passos conforme saem.

    A thread existe porque as etapas nascem NO FUNDO da pilha — dentro de
    `gerar`, de `gerar_filtro`, do laço que lê o JSON do planejador — e um
    gerador não consegue ceder de lá. Uma fila atravessa qualquer profundidade
    sem que nenhuma dessas funções precise saber que existe HTTP do outro lado:
    elas recebem uma função de um argumento e a chamam.

    O DuckDB é acessado por essa thread, e isso é seguro porque `Database.run`
    serializa tudo num lock — a mesma proteção que já valia para as requisições
    concorrentes do painel.
    """
    fila: queue.Queue = queue.Queue()
    caixa: dict = {}

    def rodar() -> None:
        try:
            caixa["resultado"] = trabalho(fila.put)
        except Exception as exc:  # noqa: BLE001
            logging.exception("erro no trabalho com relato")
            caixa["erro"] = f"{type(exc).__name__}: {exc}"[:300]
        finally:
            fila.put(None)

    threading.Thread(target=rodar, daemon=True).start()

    while True:
        item = fila.get()
        if item is None:
            break
        yield sse({"type": "step", **item.para_json()})

    if "erro" in caixa:
        yield sse({"type": "done", "refused": caixa["erro"], "kind": "widget"})
    else:
        yield sse({"type": "done", **caixa.get("resultado", {})})


@app.get("/api/dashboards/{painel_id}/ask/stream")
def pedir_ao_painel_transmitindo(
    painel_id: str, request: str = Query(..., min_length=3, max_length=600)
) -> StreamingResponse:
    """O mesmo que `/ask`, relatando cada etapa enquanto ela acontece.

    É GET porque `EventSource` no navegador só faz GET — o mesmo motivo de
    `/api/ask` e `/api/investigate` serem GET.

    Toda etapa transmitida aqui é um FATO: ela abre quando aquele trabalho
    começa e fecha quando termina, com o que produziu. Nada avança por
    temporizador. Uma barra que anda sozinha chegaria ao fim antes do modelo e
    ficaria parada ali, e a pessoa não teria como distinguir isso de travado —
    que é exatamente o problema que este endpoint existe para resolver.
    """
    pedido = request.strip()

    def trabalho(relatar) -> dict:
        try:
            paineis().ler(painel_id)
        except PainelInexistente:
            return {"kind": "widget", "refused": "Painel não encontrado."}

        prog.relata(relatar, "rotear", "Entendendo o pedido")
        alvo, motivo = rotear_painel.rotear(pedido)
        prog.fecha(relatar, "rotear", "Entendendo o pedido", ROTULO_ALVO.get(alvo, alvo))

        if alvo == "analise":
            plano = planejar_painel.planejar(pedido, relatar)
            return {"kind": "analise", "reason": motivo, **plano.para_json()}

        if alvo == "filtro":
            atual = paineis().ler(painel_id)
            catalogo = "\n".join(f"- {w.id} | {w.titulo}" for w in atual.widgets)
            r = gerar_filtro.gerar(pedido, agente().db, catalogo, relatar)
            if r.filtro is None:
                return {"kind": "filtro", "refused": r.recusa, "reason": motivo}
            prog.relata(relatar, "salvar", "Guardando no painel")
            painel = paineis().acrescentar_filtro(painel_id, r.filtro)
            validos = [w for w in r.apenas if atual.widget(w) is not None]
            if validos:
                painel = paineis().restringir_filtro(painel_id, r.filtro.id, validos)
            prog.fecha(relatar, "salvar", "Guardando no painel", r.filtro.rotulo)
            return {"kind": "filtro", "refused": "", "reason": motivo, "createdId": r.filtro.id}

        rw = gerar_widget.gerar(pedido, agente().db, relatar)
        if rw.widget is None:
            return {"kind": "widget", "refused": rw.recusa, "reason": motivo}
        prog.relata(relatar, "salvar", "Guardando no painel")
        paineis().acrescentar(painel_id, rw.widget)
        prog.fecha(relatar, "salvar", "Guardando no painel", rw.widget.titulo[:50])
        return {"kind": "widget", "refused": "", "reason": motivo, "createdId": rw.widget.id}

    return StreamingResponse(
        _com_relato(trabalho),
        media_type="text/event-stream",
        # Sem isto um proxy pode segurar os pedaços e entregar tudo no fim —
        # que é precisamente o que este endpoint existe para não fazer.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


ROTULO_ALVO = {"widget": "um gráfico", "filtro": "um filtro", "analise": "uma análise inteira"}


@app.get("/api/dashboards/{painel_id}/plan/stream")
def planejar_transmitindo(
    painel_id: str, request: str = Query(..., min_length=3, max_length=600)
) -> StreamingResponse:
    """O plano, com os itens aparecendo conforme o modelo os escreve.

    Sem roteador no caminho: quem clicou no botão "Análise completa" já disse a
    intenção, e passar pela classificação só acrescentaria uma chance de errar.
    """
    pedido = request.strip()

    def trabalho(relatar) -> dict:
        try:
            paineis().ler(painel_id)
        except PainelInexistente:
            return {"refused": "Painel não encontrado.", "items": []}
        return planejar_painel.planejar(pedido, relatar).para_json()

    return StreamingResponse(
        _com_relato(trabalho),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/dashboards/{painel_id}/plan")
def planejar_painel_completo(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Transforma um assunto num plano de mostradores, sem criar nenhum.

    Separado do `/ask` para o botão "Análise completa" do menu não depender da
    classificação: quando a pessoa escolheu o botão, a intenção já é conhecida e
    passar pelo roteador só acrescentaria uma chance de errar.
    """
    pedido = str(corpo.get("request") or "").strip()
    if len(pedido) < 3:
        return JSONResponse({"error": "Pedido muito curto."}, status_code=400)
    try:
        paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)
    return JSONResponse(planejar_painel.planejar(pedido).para_json())


@app.post("/api/dashboards/{painel_id}/widgets/manual")
def criar_widget_manual(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Monta um gráfico a partir de escolhas de menu. Sem modelo no caminho.

    O corpo traz ids do catálogo e números — nunca SQL. Se a tela pudesse mandar
    a consulta, o menu manual seria um console de SQL com aparência de menu, e o
    validador viraria enfeite.
    """
    try:
        paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)

    pedido = montar_painel.Pedido(
        medida=str(corpo.get("measure") or ""),
        campo=str(corpo.get("field") or ""),
        serie=str(corpo.get("series") or ""),
        forma=str(corpo.get("form") or "barra"),
        ordem=str(corpo.get("order") or "valor_desc"),
        limite=int(corpo.get("limit") or montar_painel.LIMITE_PADRAO),
        titulo=str(corpo.get("title") or ""),
        aparencia=corpo.get("appearance") if isinstance(corpo.get("appearance"), dict) else None,
    )
    r = montar_painel.widget(pedido, agente().db)
    if r.widget is None:
        return JSONResponse({"refused": r.recusa})
    painel = paineis().acrescentar(painel_id, r.widget)
    return JSONResponse({"refused": "", "dashboard": painel.para_json(), "widgetId": r.widget.id})


@app.put("/api/dashboards/{painel_id}/widgets/{widget_id}/manual")
def reeditar_widget(painel_id: str, widget_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Refaz um widget a partir de novas escolhas de menu, no mesmo lugar.

    Editar não é apagar e criar: o widget novo nasceria no fim da grade e o
    painel se reorganizaria porque alguém trocou "internações" por "óbitos". O
    id, a posição e as exclusões da lupa sobrevivem.

    Só vale para quem nasceu do menu — quem tem `build`. Um widget escrito por
    modelo não guarda escolhas, e reconstruí-las a partir do SQL seria
    adivinhação que troca em silêncio o que o gráfico mede. Para esses o caminho
    é "recriar", que reusa a pergunta original.
    """
    try:
        painel = paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)
    if painel.widget(widget_id) is None:
        return JSONResponse({"error": "Widget não encontrado."}, status_code=404)

    r = montar_painel.widget(montar_painel.Pedido.de_json(corpo), agente().db)
    if r.widget is None:
        return JSONResponse({"refused": r.recusa})
    painel = paineis().substituir(painel_id, widget_id, r.widget)
    return JSONResponse({"refused": "", "dashboard": painel.para_json()})


@app.patch("/api/dashboards/{painel_id}/widgets/{widget_id}/display")
def exibicao_do_widget(painel_id: str, widget_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Compacto e tamanho do número. Não toca em SQL nem em gráfico."""
    try:
        return JSONResponse({"refused": "", "dashboard": paineis().exibir(painel_id, widget_id, corpo).para_json()})
    except PainelInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.put("/api/dashboards/{painel_id}/filters/{filtro_id}")
def reeditar_filtro(painel_id: str, filtro_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Troca coluna, controle ou nome de um filtro que já existe.

    O id sobrevive porque as exclusões por widget o referenciam: recriar com id
    novo faria todo widget que o dispensava voltar a obedecê-lo em silêncio.

    A SELEÇÃO NÃO SOBREVIVE a uma troca de coluna, e não tem como: os valores de
    UF não significam nada em SEXO. O filtro volta a nascer sem recortar, que é
    o padrão — e é melhor que herdar uma seleção que não casa com o domínio novo
    e some sem explicação.
    """
    try:
        painel = paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)
    atual = painel.filtro(filtro_id)
    if atual is None:
        return JSONResponse({"error": "Filtro não encontrado."}, status_code=404)

    campo = str(corpo.get("field") or "")
    tipo = str(corpo.get("kind") or "")
    rotulo = str(corpo.get("label") or "")

    # Só o nome mudou: nada a reconstruir, e refazer o domínio custaria uma
    # varredura no banco para trocar uma palavra na tela.
    if not campo or (campo == atual.campo and tipo == atual.tipo):
        if rotulo.strip():
            atual.rotulo = rotulo.strip()[:40]
        return JSONResponse({"refused": "", "dashboard": paineis().salvar(painel).para_json()})

    r = montar_painel.filtro(campo, tipo, agente().db, rotulo)
    if r.filtro is None:
        return JSONResponse({"refused": r.recusa})
    return JSONResponse(
        {"refused": "", "dashboard": paineis().substituir_filtro(painel_id, filtro_id, r.filtro).para_json()}
    )


@app.patch("/api/dashboards/{painel_id}/widgets/{widget_id}/chart")
def ajustar_grafico(painel_id: str, widget_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Troca a forma, os eixos e as cores de um widget que já existe.

    Só a APARÊNCIA: o SQL não é tocado, e por isso o ajuste vale para qualquer
    widget, inclusive os que um modelo escreveu. Os eixos são conferidos contra
    as colunas que a consulta devolve de fato — apontar `x` para uma coluna
    inexistente não dá erro, faz o gráfico sumir, que é pior.
    """
    try:
        painel = paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)
    w = painel.widget(widget_id)
    if w is None or w.formato != "grafico":
        return JSONResponse({"error": "Widget não encontrado ou não é gráfico."}, status_code=404)

    try:
        amostra = agente().db.run(w.sql.replace(montar_painel.TOKEN, ""), max_rows=20)
        colunas = amostra.columns
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"refused": f"A consulta do widget não executa: {str(exc)[:200]}"})

    atual = dict(w.chart or {})
    x = str(corpo.get("x") or atual.get("x") or "")
    y = str(corpo.get("y") or atual.get("y") or "")
    serie = str(corpo.get("series") if corpo.get("series") is not None else atual.get("series") or "")
    for nome, valor in (("X", x), ("Y", y)):
        if valor not in colunas:
            return JSONResponse(
                {"refused": f"O eixo {nome} aponta para '{valor}', que a consulta não devolve."}
            )
    if x == y:
        return JSONResponse({"refused": "Os dois eixos não podem ser a mesma coluna."})
    if serie and serie not in colunas:
        return JSONResponse({"refused": f"A série aponta para '{serie}', que a consulta não devolve."})

    # O eixo Y é o do VALOR, e um texto ali não desenha nada — nem dá erro. O
    # gráfico simplesmente fica em branco, e um gráfico em branco parece "não
    # há dado". Foi exatamente o que aconteceu ao trocar os eixos de um gráfico
    # de mortalidade por faixa etária: as barras sumiram sem uma palavra.
    if not _tem_numero(amostra.rows, colunas.index(y)):
        return JSONResponse(
            {
                "refused": (
                    f"O eixo Y é o do valor, e '{y}' é categoria — o gráfico sairia em "
                    "branco. Para deitar as barras, mantenha os eixos e escolha a forma "
                    "'Barras horizontais'."
                )
            }
        )

    forma = catalogo_painel.forma(str(corpo.get("kind") or atual.get("kind") or "barra"))
    if forma is None:
        return JSONResponse({"refused": "Forma de gráfico desconhecida."})
    if forma["needsSeries"] and not serie:
        return JSONResponse({"refused": f"{forma['label']} exige uma série além do eixo."})

    w.chart = {
        **atual,
        "kind": forma["id"],
        "x": x,
        "y": y,
        "series": serie,
        "title": str(corpo.get("title") or atual.get("title") or w.titulo)[:120],
        "reason": str(atual.get("reason") or ""),
        **montar_painel.aparencia(corpo.get("appearance")),
    }
    if corpo.get("title"):
        w.titulo = str(corpo["title"])[:120]
    return JSONResponse({"refused": "", "dashboard": paineis().salvar(painel).para_json()})


def _tem_numero(linhas: list, coluna: int) -> bool:
    """Se aquela coluna traz número em alguma linha da amostra.

    `bool` é subclasse de `int` em Python, e uma coluna de True/False plotada
    como valor dá um gráfico de zeros e uns — tecnicamente numérico, na prática
    inútil. Fica de fora.
    """
    return any(
        isinstance(l[coluna], (int, float)) and not isinstance(l[coluna], bool)
        for l in linhas
        if len(l) > coluna
    )


@app.delete("/api/dashboards/{painel_id}/widgets/{widget_id}")
def remover_widget(painel_id: str, widget_id: str) -> JSONResponse:
    try:
        return JSONResponse(paineis().remover(painel_id, widget_id).para_json())
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)


@app.post("/api/dashboards/{painel_id}/filters")
def criar_filtro(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Cria um filtro a partir de um pedido em linguagem natural.

    O domínio é lido do banco, não inventado: um filtro de sexo com rótulos
    escritos à mão erraria, porque nesta base os valores são 1 e 3.
    """
    pedido = str(corpo.get("request") or "").strip()
    if len(pedido) < 3:
        return JSONResponse({"error": "Pedido muito curto."}, status_code=400)
    try:
        paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)

    r = gerar_filtro.gerar(pedido, agente().db)
    if r.filtro is None:
        return JSONResponse({"refused": r.recusa})
    painel = paineis().acrescentar_filtro(painel_id, r.filtro)
    return JSONResponse({"refused": "", "dashboard": painel.para_json(), "filterId": r.filtro.id})


@app.post("/api/dashboards/{painel_id}/filters/manual")
def criar_filtro_manual(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    """Cria um filtro a partir de um campo do catálogo e um tipo de controle.

    Registrado antes de `/filters/{filtro_id}/selection` não faz diferença — os
    caminhos têm formatos distintos —, mas o corpo sim: aqui vêm ids, nunca o
    fragmento SQL. Quem monta o fragmento é o catálogo.
    """
    try:
        paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)

    r = montar_painel.filtro(
        str(corpo.get("field") or ""),
        str(corpo.get("kind") or ""),
        agente().db,
        str(corpo.get("label") or ""),
    )
    if r.filtro is None:
        return JSONResponse({"refused": r.recusa})
    painel = paineis().acrescentar_filtro(painel_id, r.filtro)
    return JSONResponse({"refused": "", "dashboard": painel.para_json(), "filterId": r.filtro.id})


@app.post("/api/dashboards/{painel_id}/widgets/{widget_id}/filters/{filtro_id}")
def alternar_filtro_do_widget(painel_id: str, widget_id: str, filtro_id: str) -> JSONResponse:
    """Liga ou desliga um filtro naquele widget. É o que a lupa controla."""
    try:
        painel = paineis().alternar_filtro_do_widget(painel_id, widget_id, filtro_id)
        return JSONResponse(painel.para_json())
    except PainelInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.delete("/api/dashboards/{painel_id}/filters/{filtro_id}")
def apagar_filtro(painel_id: str, filtro_id: str) -> JSONResponse:
    try:
        return JSONResponse(paineis().remover_filtro(painel_id, filtro_id).para_json())
    except PainelInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.post("/api/dashboards/{painel_id}/filters/{filtro_id}/selection")
def selecionar_filtro(painel_id: str, filtro_id: str, corpo: dict = Body(...)) -> JSONResponse:
    try:
        painel = paineis().selecionar(painel_id, filtro_id, list(corpo.get("selection") or []))
        return JSONResponse(painel.para_json())
    except PainelInexistente:
        return JSONResponse({"error": "Não encontrado."}, status_code=404)


@app.post("/api/dashboards/{painel_id}/grid")
def dispor_painel(painel_id: str, corpo: dict = Body(...)) -> JSONResponse:
    try:
        return JSONResponse(paineis().dispor(painel_id, list(corpo.get("layout") or [])).para_json())
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)


@app.get("/api/dashboards/{painel_id}/data")
def dados_do_painel(painel_id: str, only: str | None = Query(None)) -> JSONResponse:
    """Roda os widgets sob os filtros atuais. Sem modelo no caminho.

    `only` limita aos ids pedidos: um painel de vinte widgets seriam vinte
    varreduras a cada arrasto de slider, e o que está fora da tela pode esperar.
    """
    try:
        painel = paineis().ler(painel_id)
    except PainelInexistente:
        return JSONResponse({"error": "Painel não encontrado."}, status_code=404)
    ids = [s for s in (only or "").split(",") if s] or None
    return JSONResponse({"data": executar_painel.executar_painel(painel, agente().db, ids)})


@app.get("/api/investigate")
def investigate(
    q: str = Query(..., min_length=8, max_length=2000, description="Pergunta de investigação"),
) -> StreamingResponse:
    """Investigação com várias consultas. Leva minutos — daí o SSE.

    Endpoint separado do /api/ask de propósito: uma investigação custa 7-9
    chamadas de LLM e varre 144 milhões de linhas várias vezes. É um modo que o
    usuário escolhe sabendo que vai esperar, nunca o caminho padrão.
    """

    def fluxo() -> Iterator[str]:
        try:
            for evento in investigador().investigar_stream(q):
                yield sse(evento)
        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "failure", "message": f"Erro inesperado no servidor: {exc}"})
            yield sse({"type": "done"})

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/ask")
def ask(
    q: str = Query(..., min_length=2, max_length=2000, description="Pergunta em português"),
    history: str | None = Query(
        None, description="JSON com as rodadas anteriores: [{question, sql}]"
    ),
) -> StreamingResponse:
    turnos: list[Turn] = []
    if history:
        try:
            turnos = [
                Turn(question=h["question"], sql=h.get("sql"))
                for h in json.loads(history)
                if h.get("question")
            ]
        except Exception:
            turnos = []  # histórico malformado não deve impedir a pergunta

    def fluxo() -> Iterator[str]:
        try:
            for evento in agente().ask_stream(q, turnos):
                yield sse(evento)
        except Exception as exc:  # noqa: BLE001
            yield sse(
                {
                    "type": "failure",
                    "kind": "rede",
                    "message": f"Erro inesperado no servidor: {exc}",
                }
            )
            yield sse({"type": "done"})

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Impede buffering se houver um proxy na frente; sem isso o
            # streaming chega todo de uma vez.
            "X-Accel-Buffering": "no",
        },
    )
