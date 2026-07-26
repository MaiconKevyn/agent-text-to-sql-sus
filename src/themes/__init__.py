"""Temas de investigação: espaços de trabalho que acumulam evidência.

    from src.themes import Armazem, Bloco, Tema

    arm = Armazem()
    tema = arm.criar("COVID no SUS")
    arm.fixar(tema.id, Bloco(pergunta="Quantas mortes por covid?", ...))
"""

from . import contexto
from .models import Bloco, Definicao, Procedencia, Tema, TipoBloco
from .store import Armazem, TemaInexistente

__all__ = [
    "Armazem", "Tema", "Bloco", "Definicao", "contexto",
    "Procedencia", "TipoBloco", "TemaInexistente",
]
