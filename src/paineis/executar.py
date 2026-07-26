"""Roda os widgets de um painel sob os filtros atuais.

Aqui não há modelo nenhum. É vinculação de valores e execução — determinístico,
repetível, e é essa a razão de o SQL ter saído parametrizado lá na criação: o
mesmo filtro produz sempre o mesmo número, e uma mudança no gráfico só pode ter
vindo do filtro.

O que a função devolve para cada widget inclui `naoAplicados`: os filtros que
estão ativos no painel e que AQUELE widget não usa. Sem isso a interface não tem
como avisar, e um painel em que o filtro vale para metade dos gráficos mente sem
ninguém mentir — a pessoa move a data, vê três mudarem e dois não, e atribui a
diferença ao dado.
"""

from __future__ import annotations

from ..db import Database
from .models import Filtros, Painel, Widget

# Um painel mostra agregado. Um widget que devolve mil linhas não é widget, é
# tabela — e o corte protege a tela e o navegador.
MAX_LINHAS = 400


def _ativos(filtros: Filtros) -> list[str]:
    """Quais filtros estão de fato recortando algo agora."""
    ativos = []
    if (filtros.ano_ini, filtros.ano_fim) != (Filtros().ano_ini, Filtros().ano_fim):
        ativos.append("periodo")
    if filtros.diagnostico:
        ativos.append("diagnostico")
    if filtros.uf:
        ativos.append("uf")
    return ativos


def executar(widget: Widget, filtros: Filtros, db: Database) -> dict:
    """Executa um widget. Erro vira campo `error`, não exceção."""
    valores = [v for f in widget.filtros for v in filtros.valores(f)]
    base = {
        "id": widget.id,
        # Os filtros que estão ligados e que este widget ignora. A interface
        # mostra isso no próprio widget.
        "unapplied": [f for f in _ativos(filtros) if f not in widget.filtros],
    }
    try:
        res = db.run(widget.sql, params=valores or None, max_rows=MAX_LINHAS)
    except Exception as exc:  # noqa: BLE001
        return {**base, "error": str(exc)[:300], "result": None}

    return {
        **base,
        "error": None,
        "result": {
            "columns": res.columns,
            "rows": [list(r) for r in res.rows],
            "nRows": len(res.rows),
            "elapsed": round(res.elapsed_s, 3),
            "truncated": res.truncated,
        },
    }


def executar_painel(painel: Painel, db: Database, apenas: list[str] | None = None) -> list[dict]:
    """Todos os widgets, ou só os pedidos.

    `apenas` existe para a tela pedir o que está visível: um painel com vinte
    widgets seriam vinte varreduras a cada arrasto de slider, e o que está fora
    da janela não precisa estar pronto antes de aparecer.
    """
    alvos = [w for w in painel.widgets if apenas is None or w.id in apenas]
    return [executar(w, painel.filtros, db) for w in alvos]
