"""Conversas salvas: o chat é rascunho, o tema é artefato.

    from src.chats import Conversas, Rodada

    c = Conversas()
    chat = c.criar()
    c.acrescentar(chat.id, Rodada(pergunta="Quantas mortes por covid?", texto="..."))
"""

from .models import Chat, Rodada
from .store import ChatInexistente, Conversas

__all__ = ["Conversas", "Chat", "Rodada", "ChatInexistente"]
