"""Armazenamento de documentos em JSON, um arquivo por documento.

Extraído de `themes/store.py` quando os chats passaram a precisar do mesmo
mecanismo. O que se repete entre tema e chat não é o modelo — são as garantias:

  ESCRITA ATÔMICA. O documento é reescrito inteiro a cada mudança; uma
  interrupção no meio de um `write` deixaria o arquivo truncado e o trabalho
  perdido. Escreve-se ao lado e troca-se com `os.replace`.

  ID CONFERIDO. O id vem do cliente e vira caminho de arquivo. Sem a conferência,
  "../../etc/passwd" é um caminho válido.

O modelo de cada documento fica com quem o usa; aqui só entram as garantias.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Callable, Generic, TypeVar

T = TypeVar("T")


class DocumentoInexistente(KeyError):
    pass


class Documentos(Generic[T]):
    """Documentos JSON em disco, um arquivo por documento.

    `prefixo` separa os tipos e valida o id: um id de tema nunca abre um chat.
    """

    def __init__(
        self,
        raiz: str | Path,
        prefixo: str,
        de_json: Callable[[dict], T],
        para_json: Callable[[T], dict],
        id_de: Callable[[T], str],
        chave_ordem: Callable[[T], str],
    ):
        self.raiz = Path(raiz)
        self.raiz.mkdir(parents=True, exist_ok=True)
        self.prefixo = prefixo
        self._padrao = re.compile(rf"^{re.escape(prefixo)}_[0-9a-f]{{12}}$")
        self._de_json = de_json
        self._para_json = para_json
        self._id_de = id_de
        self._chave_ordem = chave_ordem
        # Um lock por processo. O servidor é single-writer na prática, e isto
        # basta para dois pedidos concorrentes não se sobrescreverem.
        self._lock = threading.Lock()

    def _caminho(self, id_: str) -> Path:
        if not self._padrao.match(id_):
            raise DocumentoInexistente(id_)
        return self.raiz / f"{id_}.json"

    def ler(self, id_: str) -> T:
        caminho = self._caminho(id_)
        if not caminho.exists():
            raise DocumentoInexistente(id_)
        return self._de_json(json.loads(caminho.read_text(encoding="utf-8")))

    def listar(self) -> list[T]:
        """Todos os documentos, do mais recente para o mais antigo."""
        saida: list[T] = []
        for caminho in self.raiz.glob(f"{self.prefixo}_*.json"):
            try:
                saida.append(self._de_json(json.loads(caminho.read_text(encoding="utf-8"))))
            except (json.JSONDecodeError, OSError):
                # Um arquivo corrompido não derruba a listagem inteira.
                continue
        return sorted(saida, key=self._chave_ordem, reverse=True)

    def salvar(self, doc: T) -> T:
        caminho = self._caminho(self._id_de(doc))
        dados = json.dumps(self._para_json(doc), ensure_ascii=False, indent=1)
        with self._lock:
            fd, temporario = tempfile.mkstemp(dir=self.raiz, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(dados)
                os.replace(temporario, caminho)
            except BaseException:
                Path(temporario).unlink(missing_ok=True)
                raise
        return doc

    def apagar(self, id_: str) -> None:
        try:
            self._caminho(id_).unlink(missing_ok=True)
        except DocumentoInexistente:
            pass
