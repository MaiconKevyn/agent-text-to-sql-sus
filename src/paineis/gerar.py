"""Gera um widget de painel a partir de uma pergunta em linguagem natural.

A diferença para o agente do chat é uma só, e é toda a razão do painel existir:
aqui o SQL sai com MARCADORES no lugar dos valores de filtro, e o widget declara
a quais filtros ele responde.

A alternativa seria regerar o SQL a cada mudança de filtro. Ela é pior por três
motivos, em ordem: custa uma chamada de modelo por widget por movimento de
slider; leva segundos onde o gesto pede milissegundos; e não é determinística —
o mesmo filtro duas vezes pode produzir SQL diferente, e o gráfico muda por
razão que não é o filtro. Num painel, esse é o defeito mais corrosivo que existe,
porque a pessoa atribui a mudança ao dado.

O código NÃO confia na declaração do modelo. Confere três coisas antes de aceitar
o widget: que o SQL passa pelo validador, que a quantidade de marcadores bate com
os filtros declarados, e que ele EXECUTA com valores reais. Um widget que só
falha quando alguém mexe no filtro é pior que um widget que nunca foi criado.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..db import Database, UnsafeQueryError, validate_sql
from ..llm import complete
from ..config import settings
from ..schema_context import build_schema_prompt, capability_notes
from .models import Filtros, MARCADORES, Widget

ESQUEMA_WIDGET = {
    "type": "object",
    "additionalProperties": False,
    "required": ["possivel", "titulo", "sql", "filtros", "formato", "chart", "assumptions", "recusa"],
    "properties": {
        "possivel": {
            "type": "boolean",
            "description": "false se a base não tem o dado, ou se o pedido não é um gráfico nem um número.",
        },
        "titulo": {"type": "string", "description": "Título curto do widget, sem ponto final."},
        "sql": {
            "type": "string",
            "description": (
                "SELECT em DuckDB com `?` no lugar de CADA valor de filtro declarado, "
                "na mesma ordem de `filtros`. Nunca escreva o valor no SQL."
            ),
        },
        "filtros": {
            "type": "array",
            "items": {"type": "string", "enum": ["periodo", "diagnostico", "uf"]},
            "description": (
                "Os filtros que este widget aplica, na ordem dos `?`. Só liste o que a "
                "consulta REALMENTE usa. Lista vazia é resposta legítima."
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

Este SQL vai rodar de novo a cada vez que alguém mexer num filtro. Por isso os \
valores de filtro NÃO vão escritos na query — vão como `?`, e o código vincula \
os valores na hora. Você declara em `filtros` quais deles a consulta usa, NA \
ORDEM EM QUE OS `?` APARECEM.

Os três filtros, e o que cada um ocupa:

  periodo — DOIS `?`, o ano inicial e o final. Use assim:
      WHERE year(DT_SAIDA) BETWEEN ? AND ?

  diagnostico — UM `?`, um prefixo de CID-10 já com o `%`. Use assim:
      AND DIAG_PRINC LIKE ?
    O valor chega como 'C%' ou 'C50%' ou '%' (tudo). Não escreva o `%` no SQL,
    e use LIKE — nunca `=`.

  uf — UM `?`, a sigla. Exige a junção com municipios, e use LIKE, não `=`:
      JOIN municipios m ON i.MUNIC_RES = m.CO_MUNICIPIO_6D ... AND m.SG_UF LIKE ?
    O valor chega como 'RS' ou '%' (todas). Com `=`, o caso "todas" não casaria \
com nada e o widget viria vazio.

## SÓ LISTE O QUE A CONSULTA USA DE VERDADE

Se o widget não tem recorte temporal, não liste `periodo` e não ponha os `?`. \
Uma lista errada é o pior defeito possível aqui: a pessoa move a data, o widget \
não muda, e ela conclui que o DADO não mudou. A interface avisa quais widgets \
não respondem a cada filtro — para isso a declaração tem de ser honesta.

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


_MARCADOR = re.compile(r"\?")


def _conta_marcadores(sql: str) -> int:
    """Conta `?` fora de literais de string e de comentários."""
    limpo = re.sub(r"--[^\n]*", " ", sql)
    limpo = re.sub(r"/\*.*?\*/", " ", limpo, flags=re.S)
    limpo = re.sub(r"'(?:''|[^'])*'", "''", limpo)
    return len(_MARCADOR.findall(limpo))


def gerar(pergunta: str, db: Database) -> Resultado:
    """Cria um widget, ou recusa. Nunca devolve widget que não executa."""
    bruto = complete(
        model=settings.sql_model,
        system=SISTEMA.format(schema=build_schema_prompt(), capabilities=capability_notes()),
        messages=[{"role": "user", "content": f"Widget pedido: {pergunta}"}],
        schema=ESQUEMA_WIDGET,
        schema_name="widget",
        reasoning_effort="medium",
    )
    assert isinstance(bruto, dict)

    if not bruto.get("possivel"):
        return Resultado(recusa=str(bruto.get("recusa") or "A base não responde a isso.")[:400])

    sql = str(bruto.get("sql") or "").strip()
    filtros = [f for f in (bruto.get("filtros") or []) if f in MARCADORES]

    try:
        sql = validate_sql(sql)
    except UnsafeQueryError as exc:
        return Resultado(recusa=f"SQL recusado pelo validador: {exc}")

    esperados = sum(MARCADORES[f] for f in filtros)
    achados = _conta_marcadores(sql)
    if achados != esperados:
        # Não tem conserto automático: se sobra marcador, a vinculação erra de
        # posição e o widget filtra pela coisa errada em silêncio.
        return Resultado(
            recusa=(
                f"A consulta tem {achados} marcador(es) e os filtros declarados "
                f"({', '.join(filtros) or 'nenhum'}) pedem {esperados}."
            )
        )

    # A prova real: roda com valores de verdade. Um widget que só quebra quando
    # alguém mexe no filtro é pior que um que nunca existiu.
    padrao = Filtros()
    valores = [v for f in filtros for v in padrao.valores(f)]
    try:
        res = db.run(sql, params=valores or None, max_rows=1)
    except Exception as exc:  # noqa: BLE001
        return Resultado(recusa=f"A consulta não executou: {str(exc)[:220]}")

    # Sem filtro nenhum, um widget de painel TEM de devolver linha. Zero aqui
    # não é "não há dado" — é consulta errada, e o modo mais comum é usar `=`
    # onde o filtro manda `%`: `SG_UF = '%'` não casa com nada, e o widget
    # nasceria permanentemente vazio sem nunca dar erro.
    if not res.rows:
        return Resultado(
            recusa=(
                "A consulta não devolve nenhuma linha sem filtro algum. Costuma ser "
                "`=` onde deveria ser LIKE nos filtros de diagnóstico ou UF."
            )
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
            filtros=filtros,
            chart=chart if formato == "grafico" and chart.get("kind") not in (None, "", "nenhum") else None,
            formato=formato,
            suposicoes=[str(a) for a in (bruto.get("assumptions") or [])][:6],
        )
    )
