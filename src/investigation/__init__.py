"""Harness de investigação: várias consultas para uma pergunta só.

    from src.investigation import Investigador
    rel = Investigador().investigar("Existe relação entre câncer e idade?")

Ou, para acompanhar o progresso na interface:

    for evento in Investigador().investigar_stream(pergunta):
        ...
"""

from .models import Achado, Etapa, Relatorio
from .report import para_json
from .runner import Investigador

__all__ = ["Investigador", "Relatorio", "Achado", "Etapa", "para_json"]
