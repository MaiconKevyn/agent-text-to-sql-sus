"""Conversas salvas em disco. As garantias vêm de `src/storage.py`."""

from __future__ import annotations

from pathlib import Path

from ..config import settings
from ..storage import DocumentoInexistente, Documentos
from .models import Chat, Rodada


class ChatInexistente(DocumentoInexistente):
    pass


class Conversas:
    def __init__(self, raiz: str | Path | None = None):
        self._docs: Documentos[Chat] = Documentos(
            raiz or getattr(settings, "chats_dir", "data/chats"),
            prefixo="chat",
            de_json=Chat.de_json,
            para_json=lambda c: c.para_json(),
            id_de=lambda c: c.id,
            chave_ordem=lambda c: c.atualizado_em,
        )

    def ler(self, id_: str) -> Chat:
        try:
            return self._docs.ler(id_)
        except DocumentoInexistente as e:
            raise ChatInexistente(id_) from e

    def listar(self) -> list[Chat]:
        return self._docs.listar()

    def criar(self) -> Chat:
        return self._docs.salvar(Chat())

    def acrescentar(self, id_: str, rodada: Rodada) -> Chat:
        """Salva uma rodada assim que ela termina.

        Incremental e não ao fechar: quem fecha a aba não avisa antes, e é
        justamente aí que a conversa se perderia.
        """
        chat = self.ler(id_)
        chat.acrescenta(rodada)
        return self._docs.salvar(chat)

    def apagar(self, id_: str) -> None:
        self._docs.apagar(id_)
