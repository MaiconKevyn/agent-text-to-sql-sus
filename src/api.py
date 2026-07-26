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
from collections.abc import Iterator

import yaml
from fastapi import Body, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import concepts
from .investigation import Investigador
from .chats import ChatInexistente, Conversas, Rodada as RodadaChat
from .themes import Armazem, Bloco, Definicao, TemaInexistente, contexto as ctx_tema
from .agent import TextToSQLAgent, Turn
from .config import settings
from .db import Database

app = FastAPI(
    title="Consulta SIH/SUS",
    description="Perguntas em português sobre 144 milhões de internações do SUS.",
    version="1.0.0",
)

# O Vite serve em 5173; as portas alternativas cobrem o caso de a principal
# estar ocupada.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):(5173|5174|5175|4173)",
    allow_methods=["GET", "POST", "DELETE"],
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
            for evento in agente().ask_stream(q, turnos, contexto_tema=contexto):
                yield sse(evento)
        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "failure", "kind": "rede", "message": f"Erro: {exc}"})
            yield sse({"type": "done"})

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
