"""Pipeline text-to-SQL: pergunta -> SQL -> execução -> resposta em português.

    pergunta
      -> value linking (códigos reais das dimensões)
      -> geração de SQL (schema + regras críticas no prompt)
      -> validação estática (só SELECT, sem tabela proibida) + EXPLAIN
      -> execução no DuckDB (com auto-correção em caso de erro)
      -> síntese da resposta em linguagem natural
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .config import settings
from .db import Database, QueryResult, validate_sql
from .llm import SQL_SCHEMA, complete
from .schema_context import build_schema_prompt, capability_notes
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
5. Em rankings de taxa, exija um volume mínimo (HAVING COUNT(*) >= 1000) para \
não trazer grupos minúsculos com 100%.
6. Respeite a GRANULARIDADE pedida. Se a pergunta pede um número único, \
devolva UMA linha com UMA coluna — não acrescente quebras que ninguém pediu. \
Se pede uma quebra, devolva uma linha por grupo.
7. Se a pergunta pedir algo que a base não tem, marque answerable=false e \
explique o que falta — não invente coluna nem tabela.
8. NÃO substitua silenciosamente um campo por uma definição própria. Se a \
pergunta se apoia numa coluna que a base tem mas está corrompida, marque \
answerable=false e explique o problema. Em particular, nunca construa uma \
definição clínica própria (uma lista de CIDs "equivalentes") para substituir \
um campo quebrado — isso produz um número que parece oficial e não é.
9. Se a pergunta for ambígua, escolha a leitura mais natural, siga em frente e \
registre a escolha em `assumptions`.

Restrições:
- Apenas um SELECT (ou WITH ... SELECT). Nada de DDL/DML.
- Nunca consulte `_staging_internacoes`, `hospital` nem `socioeconomico`.
- Sempre limite resultados não agregados.

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
            "Se a pergunta nova for um acompanhamento (\"e em 2020?\", \"agora só "
            "para homens\", \"e por UF?\"), parta do SQL anterior e altere apenas o "
            "que mudou. Se for um assunto novo, ignore este histórico.\n\n"
            + "\n\n".join(blocks[-HISTORY_TURNS:])
        )

    def generate_sql(
        self, question: str, hints: str = "", history: list[Turn] | None = None
    ) -> dict:
        user = f"Pergunta: {question}"
        if hints:
            user += f"\n\n{hints}"
        user += self._render_history(history or [])
        return complete(
            model=settings.sql_model,
            system=self._system,
            messages=[{"role": "user", "content": user}],
            schema=SQL_SCHEMA,
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
    def synthesize(
        self, question: str, res: QueryResult, assumptions: list[str]
    ) -> str:
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
        )


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
