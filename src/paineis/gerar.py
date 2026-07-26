"""Gera um widget de painel a partir de uma pergunta em linguagem natural.

A diferença para o agente do chat é uma só, e é toda a razão do painel existir:
aqui o SQL sai com um TOKEN no lugar das condições de filtro. Os filtros do
painel são criados pelo usuário, então na hora de escrever a consulta não se
sabe quais serão — o widget reserva o lugar e o código injeta a conjunção do que
estiver ativo.

A alternativa seria regerar o SQL a cada mudança de filtro. Ela é pior por três
motivos, em ordem: custa uma chamada de modelo por widget por movimento de
slider; leva segundos onde o gesto pede milissegundos; e não é determinística —
o mesmo filtro duas vezes pode produzir SQL diferente, e o gráfico muda por
razão que não é o filtro. Num painel, esse é o defeito mais corrosivo que existe,
porque a pessoa atribui a mudança ao dado.

O código NÃO confia no que o modelo escreveu. Confere quatro coisas antes de
aceitar o widget: que o SQL passa pelo validador, que o token está lá, que o
fato está aliasado como `i` (senão os fragmentos de filtro não o encontram), e
que a consulta EXECUTA — sem filtro e com um filtro de mentira. Um widget que só
falha quando alguém mexe no filtro é pior que um que nunca foi criado.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..db import Database, UnsafeQueryError, validate_sql
from ..llm import complete
from ..config import settings
from ..schema_context import build_schema_prompt, capability_notes
from .filtros import TOKEN
from .models import Widget

ESQUEMA_WIDGET = {
    "type": "object",
    "additionalProperties": False,
    "required": ["possivel", "titulo", "sql", "formato", "chart", "assumptions", "recusa"],
    "properties": {
        "possivel": {
            "type": "boolean",
            "description": "false se a base não tem o dado, ou se o pedido não é um gráfico nem um número.",
        },
        "titulo": {"type": "string", "description": "Título curto do widget, sem ponto final."},
        "sql": {
            "type": "string",
            "description": (
                "SELECT em DuckDB, com o fato aliasado como `i` e o token dos filtros "
                "dentro do WHERE. Sem `?` — os filtros trazem os seus."
            ),
        },
        "formato": {
            "type": "string",
            "enum": ["grafico", "indicador"],
            "description": "'indicador' quando o resultado é um número só; senão 'grafico'.",
        },
        "chart": {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "x", "y", "series", "title", "reason"],
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["nenhum", "linha", "barra", "barra_horizontal", "pizza", "dispersao", "heatmap", "empilhada_100"],
                },
                "x": {"type": "string", "description": "Nome EXATO da coluna do SELECT no eixo de categoria."},
                "y": {"type": "string", "description": "Nome EXATO da coluna com a medida numérica."},
                "series": {"type": "string", "description": "Coluna que separa séries; vazio se houver uma só."},
                "title": {"type": "string"},
                "reason": {"type": "string"},
            },
        },
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "recusa": {"type": "string", "description": "Se possivel=false, o que falta na base."},
    },
}

SISTEMA = """Você monta um WIDGET de painel sobre internações do SUS: uma consulta \
que vai ser reexecutada muitas vezes, com filtros que mudam.

{schema}

## O QUE MUDA EM RELAÇÃO A UMA CONSULTA COMUM

Este SQL roda de novo a cada vez que alguém mexe num filtro, e os filtros do \
painel são criados pelo usuário — você não sabe quais serão. Por isso a consulta \
NÃO escreve condição de filtro: ela deixa um lugar reservado.

Escreva `{token}` dentro do WHERE, no fim das suas próprias condições:

    SELECT year(i.DT_SAIDA) AS ano, COUNT(*) AS n
    FROM internacoes i
    WHERE i.DT_SAIDA IS NOT NULL {token}
    GROUP BY 1 ORDER BY 1

O código troca o token pela conjunção dos filtros ativos, ou por nada quando \
não há nenhum. Três regras:

  O TOKEN É OBRIGATÓRIO. Sem ele o widget não responde a filtro nenhum, e um \
mostrador que ignora os filtros do painel é pior que a ausência dele.

  SEMPRE DEPOIS DE UM WHERE. Se a consulta não tinha filtro próprio, escreva \
`WHERE 1=1 {token}`. O token vira ` AND (...)`, então precisa de algo antes.

  O FATO TEM DE SE CHAMAR `i`. Escreva `FROM internacoes i`. Os fragmentos de \
filtro referenciam `i.<coluna>`, e sem esse alias eles não encontram a tabela.

## O RESTO É COMO SEMPRE

Só SELECT. Um comando. Sem escrita. Agregue — um painel mostra número, não \
listagem. `formato` é 'indicador' quando o SELECT devolve uma linha e uma \
coluna; nos outros casos, 'grafico', e aí `chart.x` e `chart.y` apontam para \
NOMES DE COLUNA do seu próprio SELECT.

{capabilities}"""


@dataclass
class Resultado:
    widget: Widget | None = None
    recusa: str = ""


_ALIAS_FATO = re.compile(r"\binternacoes\s+(?:as\s+)?i\b", re.I)


def gerar(pergunta: str, db: Database) -> Resultado:
    """Cria um widget, ou recusa. Nunca devolve widget que não executa."""
    bruto = complete(
        model=settings.sql_model,
        system=SISTEMA.format(schema=build_schema_prompt(), capabilities=capability_notes(), token=TOKEN),
        messages=[{"role": "user", "content": f"Widget pedido: {pergunta}"}],
        schema=ESQUEMA_WIDGET,
        schema_name="widget",
        reasoning_effort="medium",
    )
    assert isinstance(bruto, dict)

    if not bruto.get("possivel"):
        return Resultado(recusa=str(bruto.get("recusa") or "A base não responde a isso.")[:400])

    sql = str(bruto.get("sql") or "").strip()

    try:
        sql = validate_sql(sql)
    except UnsafeQueryError as exc:
        return Resultado(recusa=f"SQL recusado pelo validador: {exc}")

    if TOKEN not in sql:
        return Resultado(
            recusa=(
                f"A consulta não reservou lugar para os filtros ({TOKEN} no WHERE). "
                "Sem ele o widget ignoraria todos os filtros do painel."
            )
        )
    if not _ALIAS_FATO.search(sql):
        return Resultado(
            recusa=(
                "A consulta precisa aliasar o fato como `i` (FROM internacoes i): "
                "os fragmentos de filtro referenciam `i.<coluna>`."
            )
        )

    # Duas provas: sem filtro nenhum, e com um filtro qualquer no lugar do
    # token. A segunda pega o caso em que o token ficou fora do WHERE e a
    # conjunção vira erro de sintaxe só quando alguém cria o primeiro filtro.
    try:
        res = db.run(sql.replace(TOKEN, ""), max_rows=1)
    except Exception as exc:  # noqa: BLE001
        return Resultado(recusa=f"A consulta não executou: {str(exc)[:220]}")
    try:
        db.run(sql.replace(TOKEN, " AND (1=1)"), max_rows=1)
    except Exception as exc:  # noqa: BLE001
        return Resultado(recusa=f"O token não está num WHERE utilizável: {str(exc)[:200]}")

    # Sem filtro nenhum, um widget de painel TEM de devolver linha. Zero aqui
    # não é "não há dado" — é consulta errada.
    if not res.rows:
        return Resultado(
            recusa="A consulta não devolve nenhuma linha sem filtro algum. Reveja as condições."
        )

    chart = bruto.get("chart") or {}
    formato = bruto.get("formato") if bruto.get("formato") in ("grafico", "indicador") else "grafico"
    # Um SELECT de uma coluna não vira gráfico, diga o modelo o que disser.
    if len(res.columns) == 1:
        formato = "indicador"

    return Resultado(
        widget=Widget(
            titulo=str(bruto.get("titulo") or pergunta)[:120],
            pergunta=pergunta,
            sql=sql,
            chart=chart if formato == "grafico" and chart.get("kind") not in (None, "", "nenhum") else None,
            formato=formato,
            suposicoes=[str(a) for a in (bruto.get("assumptions") or [])][:6],
        )
    )
