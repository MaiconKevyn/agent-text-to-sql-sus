"""Pipeline text-to-SQL: pergunta -> SQL -> execução -> resposta em português.

    pergunta
      -> value linking (códigos reais das dimensões)
      -> geração de SQL (schema + regras críticas no prompt)
      -> validação estática (só SELECT, sem tabela proibida) + EXPLAIN
      -> execução no DuckDB (com auto-correção em caso de erro)
      -> síntese da resposta em linguagem natural
"""
from __future__ import annotations

import json
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from .config import settings
from .db import Database, QueryResult, validate_sql
from .llm import SQL_SCHEMA, SQL_SCHEMA_COM_HISTORICO, complete, complete_streaming
from .schema_context import build_schema_prompt, capability_notes
from .value_linker import _terms as _termos_da_pergunta
from .value_linker import link_values

SQL_SYSTEM_PROMPT = """\
Você é um engenheiro de dados especialista no SIH/SUS (Sistema de Informações \
Hospitalares do DATASUS) e em SQL do DuckDB. Traduza a pergunta do usuário em \
UMA query SELECT correta.

Método:
1. Identifique a métrica (contagem, soma, média, taxa), o recorte (filtros) e a \
quebra (group by) pedidos.
2. Confira TODAS as REGRAS CRÍTICAS abaixo antes de escrever. Elas descrevem \
armadilhas reais desta base; violá-las devolve resultado errado sem dar erro.
3. Prefira juntar com as tabelas de dimensão para devolver rótulos legíveis \
(nome do diagnóstico, do procedimento, da UF) em vez de códigos crus.
4. Dê apelidos em português às colunas do resultado.
5. Só imponha volume mínimo (HAVING COUNT(*) >= 1000) em ranking de taxa sobre \
grupo de ALTA CARDINALIDADE — diagnóstico, procedimento, município, CNES — onde \
existem milhares de grupos e os minúsculos apareceriam com 100%. NÃO use HAVING \
quando a quebra é por uma dimensão fechada e pequena (sexo, raça/cor, \
complexidade, caráter, especialidade): ali toda categoria deve aparecer, por \
menor que seja.
6. NUNCA extrapole, projete ou preveja. A base cobre 2007-2023 e só responde \
sobre o que foi observado. Se pedirem previsão, tendência futura ou estimativa \
para um ano fora do período, marque answerable=false e explique que isso exigiria \
um modelo estatístico, não uma consulta. Ofereça a série histórica no lugar.
7. Respeite a GRANULARIDADE pedida. Se a pergunta pede um número único, \
devolva UMA linha com UMA coluna — não acrescente quebras que ninguém pediu. \
Se pede uma quebra, devolva uma linha por grupo.
8. Se a pergunta pedir algo que a base não tem, marque answerable=false e \
explique o que falta — não invente coluna nem tabela.
9. NÃO substitua silenciosamente um campo por uma definição própria. Se a \
pergunta se apoia numa coluna que a base tem mas está corrompida, marque \
answerable=false e explique o problema. Em particular, nunca construa uma \
definição clínica própria (uma lista de CIDs "equivalentes") para substituir \
um campo quebrado — isso produz um número que parece oficial e não é.
10. Se a pergunta for ambígua, escolha a leitura mais natural, siga em frente e \
registre a escolha em `assumptions`.

Restrições:
- Apenas um SELECT (ou WITH ... SELECT). Nada de DDL/DML.
- Nunca consulte `_staging_internacoes`, `hospital` nem `socioeconomico`.
- Sempre limite resultados não agregados.

## GRÁFICO (campo `chart`)

Você declara a FORMA. Você NUNCA escreve os pontos: quem monta a série é a
interface, a partir das linhas que o banco devolver. Por isso `x`, `y` e
`series` têm de ser nomes EXATOS de colunas do seu SELECT — se você inventar um
nome, o gráfico simplesmente não aparece.

`x`, `y` e `series` APONTAM para colunas; não são nomes de colunas. NUNCA use
`AS x`, `AS y` ou `AS series` no SELECT. O usuário vê a tabela do resultado, e
uma coluna chamada `x` não diz nada. Dê o alias pelo que o dado É — `ano`, `uf`,
`municipio`, `sexo`, `internacoes` — e então aponte `x: "ano"`, `y:
"internacoes"`, `series: "sexo"`.

Escolha da forma, pela pergunta e pelo formato do resultado:
- `linha` — evolução no tempo. O eixo x é ano/mês/data.
- `barra` — comparação entre categorias com rótulo curto (UF, sexo, ano).
- `barra_horizontal` — ranking, ou rótulos longos (nome de município, de CID).
- `pizza` — parte-do-todo, no máximo 6 fatias, e só se o usuário pedir
  proporção ou pizza. Para mais de 6 categorias use `barra_horizontal`.
- `dispersao` — relação entre DUAS medidas contínuas. `x` e `y` são as duas
  medidas; `series` fica vazio e o rótulo do ponto sai da 1ª coluna.
- `heatmap` — matriz de duas categorias (ex.: mês × ano). `x` e `series` são as
  duas categorias e `y` é a medida.
- `empilhada_100` — composição em porcentagem ao longo de uma categoria.

Use `nenhum` quando:
- o resultado é um número só (não se faz gráfico de um valor);
- o resultado tem 1 ou 2 linhas — a frase já diz tudo;
- as colunas numéricas têm unidades diferentes (contagem e reais, por exemplo);
  duas escalas num eixo só produzem leitura errada. Escolha UMA medida.
- o usuário não pediu gráfico e a tabela responde melhor.

Se o usuário pediu gráfico explicitamente, ESCREVA O SQL PENSANDO NO GRÁFICO:
ordene por tempo quando for série temporal, limite o top-N quando for ranking, e
devolva a coluna de rótulo legível (nome do município, descrição do CID) junto
com o código — não só o código.

{schema}

## O QUE ESTA BASE NÃO RESPONDE
{capabilities}
"""

ANSWER_SYSTEM_PROMPT = """\
Você é um analista de dados de saúde pública. Escreva, em português do Brasil, \
a resposta para a pergunta do usuário a partir do resultado da query.

Regras:
- Comece pela resposta direta. Nada de preâmbulo.
- Cite os números com separador de milhar (1.234.567) e valores em reais como \
R$ 1.234,56. Percentuais com uma ou duas casas.
- Não invente nada que não esteja no resultado. Se o resultado veio vazio, diga \
isso e sugira o motivo provável.
- Se houver suposições relevantes, mencione-as em uma frase ao final.
- Seja conciso: 1 a 4 frases para resultados escalares; para tabelas, um resumo \
curto mais os destaques. Não repita a tabela inteira linha a linha.
- Não mostre a query nem fale de SQL: o usuário já a vê separadamente.
- Se o usuário pediu um GRÁFICO, a interface já o desenhou logo acima do seu \
texto. NUNCA escreva código (Python, matplotlib, JavaScript) nem descreva como \
plotar, e não diga "segue o gráfico abaixo". Escreva o que o gráfico MOSTRA: a \
tendência, o pico, a virada, o contraste entre as séries.

RESSALVAS OBRIGATÓRIAS — se alguma se aplicar ao resultado, inclua uma frase \
curta de aviso; se não se aplicar, não mencione:
- Resultado quebrado por UF ou município: São Paulo e Tocantins estão \
subrepresentados na base por falha de extração (SP tem 88.884 internações em 17 \
anos, menos que Roraima). Nunca apresente SP ou TO como tendo pouca demanda \
real — diga que o dado está incompleto.
- Recorte por raça/cor: 29,2% dos registros são "Sem informação".
- Comparação de valores em reais entre anos distantes: os valores são nominais, \
não deflacionados.
- Série ou comparação anual incluindo 2007: é ano parcial (só agosto a dezembro).
- Qualquer recorte geográfico: refere-se ao município de RESIDÊNCIA do paciente, \
não ao local do atendimento.
"""


# Quantas rodadas anteriores entram no prompt. Mais que isso polui o contexto e
# faz o modelo arrastar filtros que o usuário já abandonou.
HISTORY_TURNS = 3


@dataclass
class Turn:
    question: str
    sql: str | None


@dataclass
class AgentResult:
    question: str
    answer: str
    sql: str | None = None
    result: QueryResult | None = None
    answerable: bool = True
    reasoning: str = ""
    assumptions: list[str] = field(default_factory=list)
    attempts: int = 1
    errors: list[str] = field(default_factory=list)
    value_hints: str = ""
    # O que o agente fez com a pergunta anterior. `None` quando não houve
    # histórico — que é sempre o caso na avaliação.
    continuity: dict | None = None


def _clean_sql(sql: str) -> str:
    """Remove cercas de markdown que o modelo às vezes inclui."""
    sql = sql.strip()
    sql = re.sub(r"^```(?:sql)?\s*", "", sql)
    sql = re.sub(r"\s*```$", "", sql)
    return sql.strip()


def _format_rows(res: QueryResult, max_rows: int) -> str:
    if not res.rows:
        return "(nenhuma linha)"
    head = " | ".join(res.columns)
    body = "\n".join(
        " | ".join("NULL" if v is None else str(v) for v in row)
        for row in res.rows[:max_rows]
    )
    extra = ""
    if len(res.rows) > max_rows:
        extra = f"\n... (+{len(res.rows) - max_rows} linhas omitidas)"
    return f"{head}\n{'-' * len(head)}\n{body}{extra}"


class TextToSQLAgent:
    def __init__(self, db: Database | None = None):
        self.db = db or Database()
        self._system = SQL_SYSTEM_PROMPT.format(
            schema=build_schema_prompt(), capabilities=capability_notes()
        )
        self._trace_seq = 0

    # -- etapa 1: gerar SQL -------------------------------------------------
    @staticmethod
    def _render_history(history: list[Turn]) -> str:
        """Resume as rodadas anteriores para resolver perguntas de acompanhamento."""
        if not history:
            return ""
        blocks = [
            f"Pergunta anterior: {t.question}\nSQL usado:\n{t.sql}"
            for t in history
            if t.sql
        ]
        if not blocks:
            return ""
        return (
            "\n\n## CONVERSA ATÉ AQUI\n"
            "Se a pergunta nova for um acompanhamento, parta do SQL anterior e "
            "altere apenas o que mudou. Se for um assunto novo, ignore este "
            "histórico.\n"
            "\n"
            "NÃO decida isso pela gramática. Uma pergunta pode ser uma frase "
            "completa e ainda assim continuar a anterior: depois de \"quantas "
            "mortes por covid?\", a pergunta \"em quais estados tiveram mais "
            "mortes?\" continua falando de covid, mesmo tendo sujeito e verbo "
            "próprios. O que decide é o ASSUNTO, não a forma.\n"
            "\n"
            "Na dúvida, MANTENHA os recortes anteriores: uma resposta que carrega "
            "um filtro a mais o usuário reconhece; uma que perdeu o filtro parece "
            "certa e responde outra pergunta.\n"
            "\n"
            "Preencha `continuidade` com o que você fez — inclusive o que "
            "DESCARTOU. É esse campo que o usuário vê para conferir.\n\n"
            + "\n\n".join(blocks[-HISTORY_TURNS:])
        )

    def generate_sql(
        self,
        question: str,
        hints: str = "",
        history: list[Turn] | None = None,
        contexto_tema: str = "",
    ) -> dict:
        user = f"Pergunta: {question}"
        if hints:
            user += f"\n\n{hints}"
        # O contexto do tema entra SÓ aqui, na geração de SQL. Ele nunca chega
        # à síntese da resposta: se os números dos blocos já coletados
        # estivessem no prompt que redige o texto, o modelo poderia citar um
        # deles como se tivesse vindo da consulta atual. Para comparar com um
        # bloco, a comparação tem de estar no SQL.
        if contexto_tema:
            user += f"\n\n{contexto_tema}"
        bloco_historico = self._render_history(history or [])
        user += bloco_historico
        # Sem histórico, o contrato é EXATAMENTE o de antes. A avaliação chama
        # `ask(question)` sem `history`, então cada caso continua isolado e o
        # campo `continuidade` nem é pedido ao modelo — a isolação é estrutural.
        schema = SQL_SCHEMA_COM_HISTORICO if bloco_historico else SQL_SCHEMA
        return complete(
            model=settings.sql_model,
            system=self._system,
            messages=[{"role": "user", "content": user}],
            schema=schema,
            schema_name="geracao_sql",
            reasoning_effort="medium",
        )

    def repair_sql(self, question: str, bad_sql: str, error: str, hints: str = "") -> dict:
        user = (
            f"Pergunta: {question}\n\n"
            f"Esta query falhou:\n```sql\n{bad_sql}\n```\n\n"
            f"Erro do DuckDB:\n{error}\n\n"
            "Corrija a query. Verifique nomes de coluna e tabela contra o schema "
            "acima e reconfira as REGRAS CRÍTICAS."
        )
        if hints:
            user += f"\n\nValores reais das dimensões:\n{hints}"
        return complete(
            model=settings.sql_model,
            system=self._system,
            messages=[{"role": "user", "content": user}],
            schema=SQL_SCHEMA,
            schema_name="correcao_sql",
            reasoning_effort="medium",
        )

    # -- etapa 2: executar com auto-correção --------------------------------
    def _execute_with_repair(
        self, question: str, plan: dict, hints: str
    ) -> tuple[QueryResult | None, str, int, list[str]]:
        sql = _clean_sql(plan["sql"])
        errors: list[str] = []

        for attempt in range(1, settings.max_repair_attempts + 2):
            try:
                validate_sql(sql)
                self.db.explain(sql)  # pega erro de sintaxe/coluna sem varrer 144M linhas
                # Sem `max_rows`: o resultado completo fica disponível para a
                # avaliação e para a tabela da CLI. O corte para o LLM acontece
                # depois, em `_format_rows`.
                res = self.db.run(sql)
                return res, sql, attempt, errors
            except Exception as exc:  # noqa: BLE001 — inclui UnsafeQueryError e erros do DuckDB
                msg = f"{type(exc).__name__}: {exc}"
                errors.append(msg)
                if attempt > settings.max_repair_attempts:
                    return None, sql, attempt, errors
                plan = self.repair_sql(question, sql, msg, hints)
                sql = _clean_sql(plan["sql"])

        return None, sql, settings.max_repair_attempts + 1, errors

    # -- etapa 3: sintetizar resposta ---------------------------------------
    def _payload_resposta(
        self, question: str, res: QueryResult, assumptions: list[str]
    ) -> str:
        """Monta o que o modelo lê para redigir. Compartilhado com o streaming."""
        payload = (
            f"Pergunta do usuário: {question}\n\n"
            f"Query executada:\n{res.sql}\n\n"
            f"Resultado ({len(res.rows)} linhas, {res.elapsed_s:.2f}s):\n"
            f"{_format_rows(res, settings.max_rows_to_llm)}"
        )
        if assumptions:
            payload += "\n\nSuposições feitas ao montar a query:\n" + "\n".join(
                f"- {a}" for a in assumptions
            )
        if res.extra.get("hit_injected_limit"):
            payload += (
                f"\n\nATENÇÃO: o resultado bateu no limite de "
                f"{res.extra['applied_limit']} linhas aplicado automaticamente — "
                "pode haver mais linhas. Diga isso ao usuário e não apresente o "
                "conjunto como completo."
            )
        return payload

    def synthesize(
        self, question: str, res: QueryResult, assumptions: list[str]
    ) -> str:
        payload = self._payload_resposta(question, res, assumptions)
        out = complete(
            model=settings.answer_model,
            system=ANSWER_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": payload}],
            reasoning_effort="low",
        )
        return str(out).strip()

    # -- orquestração -------------------------------------------------------
    def ask(
        self, question: str, history: list[Turn] | None = None
    ) -> AgentResult:
        hints = ""
        try:
            hints = link_values(self.db, question)
        except Exception:  # value linking é auxiliar; nunca deve derrubar o fluxo
            pass

        plan = self.generate_sql(question, hints, history)

        if not plan.get("answerable", True):
            return AgentResult(
                question=question,
                answer=plan.get("refusal")
                or "Essa pergunta não pode ser respondida com os dados disponíveis.",
                answerable=False,
                reasoning=plan.get("reasoning", ""),
                assumptions=plan.get("assumptions", []),
                value_hints=hints,
                continuity=_continuidade(plan),
            )

        res, sql, attempts, errors = self._execute_with_repair(question, plan, hints)

        if res is None:
            return AgentResult(
                question=question,
                answer=(
                    "Não consegui produzir uma query válida para essa pergunta. "
                    f"Último erro: {errors[-1] if errors else 'desconhecido'}"
                ),
                sql=sql,
                answerable=True,
                reasoning=plan.get("reasoning", ""),
                assumptions=plan.get("assumptions", []),
                attempts=attempts,
                errors=errors,
                value_hints=hints,
                continuity=_continuidade(plan),
            )

        answer = self.synthesize(question, res, plan.get("assumptions", []))
        return AgentResult(
            question=question,
            answer=answer,
            sql=res.sql,
            result=res,
            reasoning=plan.get("reasoning", ""),
            assumptions=plan.get("assumptions", []),
            attempts=attempts,
            errors=errors,
            value_hints=hints,
            continuity=_continuidade(plan),
        )

    # -- streaming de eventos ------------------------------------------------
    def ask_stream(
        self,
        question: str,
        history: list[Turn] | None = None,
        contexto_tema: str = "",
    ) -> Iterator[dict]:
        """Mesma orquestração de `ask`, emitindo cada evento quando acontece.

        É o que a API HTTP serve. O formato dos dicionários é o contrato com o
        frontend (`StreamEvent` em lib/types.ts) — mudar um lado exige mudar o
        outro.
        """
        def passo(id_: str, estado: str, **extra):
            return {"type": "step", "id": id_, "state": estado, **extra}

        def rastro(etapa: str, titulo: str, corpo: str, fmt: str = "text", **extra):
            self._trace_seq += 1
            return {
                "type": "trace",
                "entry": {
                    "id": f"t{self._trace_seq}",
                    "step": etapa,
                    "title": titulo,
                    "body": corpo,
                    "format": fmt,
                    "at": int(time.time() * 1000),
                    **extra,
                },
            }

        # ---- 1. Interpretar -------------------------------------------------
        t0 = time.perf_counter()
        yield passo("interpretar", "ativo")
        yield rastro("interpretar", "Pergunta recebida", question)
        if contexto_tema:
            yield rastro("interpretar", "Contexto do tema (blocos já fixados)", contexto_tema)
        yield rastro(
            "interpretar",
            "Instruções do sistema (schema + regras críticas)",
            self._system,
        )
        yield passo(
            "interpretar",
            "concluido",
            elapsed=round(time.perf_counter() - t0, 3),
            detail=f"{len(self._system):,} caracteres de contexto".replace(",", "."),
        )

        # ---- 2. Value linking -----------------------------------------------
        yield passo("vincular", "ativo")
        t1 = time.perf_counter()
        hints = ""
        try:
            hints = link_values(self.db, question)
        except Exception:  # auxiliar: nunca derruba o fluxo
            pass
        dt_link = round(time.perf_counter() - t1, 3)
        termos = _termos_da_pergunta(question)
        if hints:
            yield rastro(
                "vincular", "Códigos encontrados nas dimensões", hints, elapsed=dt_link
            )
            yield passo(
                "vincular",
                "concluido",
                elapsed=dt_link,
                detail=f"{len(termos)} termo(s): {', '.join(termos[:3])}",
            )
        else:
            yield rastro(
                "vincular",
                "Nenhum código para vincular",
                f"Termos extraídos: {', '.join(termos) if termos else '(nenhum)'}\n\n"
                "Nenhum termo da pergunta nomeia entidade clínica, então não há "
                "códigos a sugerir. É o esperado em perguntas puramente analíticas.",
                elapsed=dt_link,
            )
            yield passo(
                "vincular",
                "pulado",
                elapsed=dt_link,
                detail="nenhuma entidade clínica na pergunta",
            )

        # ---- 3. Gerar SQL ---------------------------------------------------
        yield passo("gerar-sql", "ativo")
        t2 = time.perf_counter()
        try:
            plan = self.generate_sql(question, hints, history, contexto_tema)
        except Exception as exc:  # noqa: BLE001
            yield passo("gerar-sql", "falhou")
            yield {
                "type": "failure",
                "kind": "rede",
                "message": f"Falha ao falar com o modelo: {exc}",
            }
            return
        dt_gen = round(time.perf_counter() - t2, 3)
        yield rastro(
            "gerar-sql",
            "Plano devolvido pelo modelo",
            json.dumps(plan, ensure_ascii=False, indent=2),
            "json",
            elapsed=dt_gen,
        )

        # ---- Recusa ---------------------------------------------------------
        if not plan.get("answerable", True):
            yield passo(
                "gerar-sql", "concluido", elapsed=dt_gen, detail="a base não tem o dado pedido"
            )
            yield passo("executar", "pulado")
            yield passo("resumir", "ativo")
            yield {"type": "refused"}
            texto = plan.get("refusal") or "Essa pergunta não pode ser respondida com os dados disponíveis."
            for pedaco in _fatiar(texto):
                yield {"type": "token", "text": pedaco}
            yield passo("resumir", "concluido")
            yield {"type": "done"}
            return

        sql_gerado = _clean_sql(plan.get("sql", ""))
        yield passo(
            "gerar-sql",
            "concluido",
            elapsed=dt_gen,
            detail=f"{len(sql_gerado.splitlines())} linhas de SQL",
        )
        yield {"type": "sql", "sql": sql_gerado}
        if cont := _continuidade(plan):
            yield {"type": "continuity", "continuity": cont}
        if plan.get("assumptions"):
            yield {"type": "assumptions", "assumptions": plan["assumptions"]}

        # ---- 4. Executar ----------------------------------------------------
        yield passo("executar", "ativo")
        res, sql_final, tentativas, erros = self._execute_with_repair(question, plan, hints)
        if res is None:
            yield passo("executar", "falhou")
            if erros:
                yield rastro("executar", "Erro do DuckDB", "\n\n".join(erros[-2:]))
            yield {
                "type": "failure",
                "kind": "sql",
                "message": (
                    f"A consulta não pôde ser executada após {tentativas} tentativa(s). "
                    f"Último erro: {erros[-1] if erros else 'desconhecido'}"
                ),
            }
            return

        if tentativas > 1:
            yield rastro(
                "executar",
                f"Auto-correção: {tentativas - 1} tentativa(s) antes de funcionar",
                "\n\n".join(erros),
            )
            yield {"type": "sql", "sql": sql_final}
        yield rastro("executar", "SQL enviado ao DuckDB (com LIMIT de segurança)", res.sql, "sql")
        yield passo(
            "executar",
            "concluido",
            elapsed=round(res.elapsed_s, 3),
            detail=f"{len(res.rows):,} linha(s) em {res.elapsed_s:.2f}s".replace(",", "."),
        )
        yield {
            "type": "result",
            "result": {
                "columns": res.columns,
                "rows": [[_json_safe(v) for v in linha] for linha in res.rows[:500]],
                "nRows": len(res.rows),
                "elapsed": round(res.elapsed_s, 3),
                "truncated": len(res.rows) > 500 or bool(res.extra.get("hit_injected_limit")),
            },
        }

        spec, descarte = _valida_chart(plan.get("chart"), res)
        if spec:
            yield {"type": "chart", "chart": spec}
            yield rastro("executar", "Gráfico declarado pelo agente", json.dumps(spec, ensure_ascii=False, indent=2), "json")
        elif descarte:
            yield rastro("executar", "Gráfico descartado", descarte)

        # ---- 5. Resumir -----------------------------------------------------
        yield passo("resumir", "ativo")
        yield rastro("resumir", "Instruções de redação da resposta", ANSWER_SYSTEM_PROMPT)
        t3 = time.perf_counter()
        try:
            for pedaco in self.synthesize_streaming(question, res, plan.get("assumptions", [])):
                yield {"type": "token", "text": pedaco}
        except Exception as exc:  # noqa: BLE001
            yield passo("resumir", "falhou")
            yield {"type": "failure", "kind": "rede", "message": f"Falha ao redigir: {exc}"}
            return
        yield passo("resumir", "concluido", elapsed=round(time.perf_counter() - t3, 3))
        yield {"type": "done"}

    def synthesize_streaming(
        self, question: str, res: QueryResult, assumptions: list[str]
    ) -> Iterator[str]:
        """Versão em streaming de `synthesize`, com o mesmo prompt."""
        return complete_streaming(
            model=settings.answer_model,
            system=ANSWER_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": self._payload_resposta(question, res, assumptions)}],
            reasoning_effort="low",
        )


_FORMAS = {
    "linha",
    "barra",
    "barra_horizontal",
    "pizza",
    "dispersao",
    "heatmap",
    "empilhada_100",
}


def _continuidade(plan: dict) -> dict | None:
    """Normaliza o campo `continuidade`, quando ele existe.

    Só existe quando houve histórico — sem histórico o schema nem o pede. O
    evento serve para a interface mostrar o que o agente fez com a pergunta
    anterior: qual recorte ele manteve e, principalmente, qual descartou. Um
    filtro descartado em silêncio é como uma resposta sobre outro assunto passa
    por resposta certa.
    """
    bruto = plan.get("continuidade")
    if not isinstance(bruto, dict):
        return None
    tipo = str(bruto.get("tipo") or "").strip()
    if tipo not in ("acompanhamento", "nova"):
        return None
    def limpa(xs) -> list[str]:
        # O modelo escreve "nenhum — mantive tudo" DENTRO de `descartado` em vez
        # de deixar a lista vazia. Sem este filtro o chip anuncia
        # "Não manteve: nenhum — mantive tudo", que diz o contrário do que é.
        vazio = ("nenhum", "nenhuma", "não descartei", "nao descartei", "n/a", "-")
        saida = []
        for x in xs or []:
            t = str(x).strip()
            if not t or t.lower().lstrip("—- ").startswith(vazio):
                continue
            saida.append(t)
        return saida

    return {
        "kind": tipo,
        "kept": limpa(bruto.get("herdado")),
        "dropped": limpa(bruto.get("descartado")),
    }


def _valida_chart(bruto: object, res: QueryResult) -> tuple[dict | None, str]:
    """Confere a declaração do modelo contra o resultado que o banco devolveu.

    O modelo pode alucinar um nome de coluna, pedir pizza com 40 fatias ou
    apontar `y` para uma coluna de texto. Em qualquer desses casos é melhor não
    ter gráfico nenhum do que ter um gráfico errado — a mesma regra que vale
    para os números da resposta. Devolve (spec, motivo_do_descarte).
    """
    if not isinstance(bruto, dict):
        return None, ""
    forma = str(bruto.get("kind") or "nenhum")
    if forma == "nenhum":
        return None, (bruto.get("reason") or "").strip()
    if forma not in _FORMAS:
        return None, f"Forma desconhecida: {forma!r}."
    if not res.rows:
        return None, "A consulta não devolveu linhas."

    # A comparação é sem distinção de caixa: o alias do SELECT pode voltar do
    # DuckDB com outra capitalização.
    por_nome = {c.lower(): c for c in res.columns}

    def coluna(chave: str) -> str | None:
        nome = str(bruto.get(chave) or "").strip()
        return por_nome.get(nome.lower())

    x, y = coluna("x"), coluna("y")
    if x is None or y is None:
        faltando = [
            f"{k}={bruto.get(k)!r}" for k in ("x", "y") if por_nome.get(str(bruto.get(k) or "").lower()) is None
        ]
        return None, f"Coluna inexistente no resultado ({', '.join(faltando)}). Colunas: {', '.join(res.columns)}."

    iy = res.columns.index(y)
    if not all(isinstance(linha[iy], (int, float)) and not isinstance(linha[iy], bool) for linha in res.rows):
        return None, f"A coluna {y!r} do eixo de valor não é numérica."

    if forma == "pizza" and len(res.rows) > 6:
        forma = "barra_horizontal"

    spec = {
        "kind": forma,
        "x": x,
        "y": y,
        "series": coluna("series"),
        "title": str(bruto.get("title") or "").strip(),
        "reason": str(bruto.get("reason") or "").strip(),
    }
    return spec, ""


def _json_safe(v):
    """Converte tipos do DuckDB que o JSON não conhece."""
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def _fatiar(texto: str, por: int = 2) -> Iterator[str]:
    """Quebra um texto pronto em pedaços, para a recusa também chegar fluindo."""
    partes = re.findall(r"\s*\S+", texto)
    for i in range(0, len(partes), por):
        yield "".join(partes[i : i + por])


class ChatSession:
    """Envelope com estado sobre o agente, para conversa multi-turno.

    A avaliação usa `TextToSQLAgent.ask` direto (sem estado, cada caso isolado);
    a CLI usa esta classe para que "e em 2020?" funcione.
    """

    def __init__(self, agent: TextToSQLAgent | None = None):
        self.agent = agent or TextToSQLAgent()
        self.history: list[Turn] = []

    def ask(self, question: str) -> AgentResult:
        result = self.agent.ask(question, history=self.history)
        # Só rodadas que produziram SQL executável servem de base para um
        # acompanhamento; uma recusa não dá o que reaproveitar.
        if result.sql and result.result is not None:
            self.history.append(Turn(question=question, sql=result.sql))
            self.history = self.history[-HISTORY_TURNS:]
        return result

    def reset(self) -> None:
        self.history.clear()
