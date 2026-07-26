"""Roda os widgets de um painel sob os filtros atuais.

Aqui não há modelo nenhum. É vinculação de valores e execução — determinístico,
repetível, e é essa a razão de o SQL ter saído parametrizado lá na criação: o
mesmo filtro produz sempre o mesmo número, e uma mudança no gráfico só pode ter
vindo do filtro.

Com os filtros declarados, todo widget que carrega o token responde a TODOS os
filtros — não há mais "este ignora aquele". O que sobra é o widget LEGADO, criado
antes disto, que não responde a nenhum e diz isso em vez de fingir que aplicou.
"""

from __future__ import annotations

from ..db import Database
from .filtros import Filtro, aplicar
from .models import Painel, Widget

# Um painel mostra agregado. Um widget que devolve mil linhas não é widget, é
# tabela — e o corte protege a tela e o navegador.
MAX_LINHAS = 400


def executar(widget: Widget, filtros: list[Filtro], db: Database) -> dict:
    """Executa um widget sob os filtros ativos. Erro vira campo, não exceção."""
    base = {"id": widget.id, "legacy": widget.legado}
    if widget.legado:
        # Widget de antes dos filtros declarados. Não é consertado por
        # adivinhação: a tela oferece recriá-lo a partir da pergunta original.
        return {
            **base,
            "error": (
                "Widget criado antes dos filtros configuráveis — ele não responde a "
                "nenhum filtro. Use 'recriar' para reconstruí-lo."
            ),
            "result": None,
        }

    sql, valores = aplicar(widget.sql, filtros)
    try:
        res = db.run(sql, params=valores or None, max_rows=MAX_LINHAS)
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
    widgets seriam vinte varreduras a cada mudança de filtro, e o que está fora
    da janela não precisa estar pronto antes de aparecer.
    """
    alvos = [w for w in painel.widgets if apenas is None or w.id in apenas]
    return [executar(w, painel.filtros, db) for w in alvos]
