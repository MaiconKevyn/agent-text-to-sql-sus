"""Armazenamento dos temas: um arquivo JSON por tema.

No SERVIDOR, e não no navegador, por três razões nesta ordem:

  1. O chat do tema precisa dos blocos no prompt. Com armazenamento no cliente,
     o frontend teria de subir todos os blocos a cada pergunta — e um bloco
     carrega até 200 linhas de tabela. Aqui a API lê o tema por id e monta o
     contexto no lugar onde ele é usado.
  2. O tema sobrevive a limpar o navegador. Uma investigação de semanas não
     pode morrer num "limpar dados de navegação".
  3. Vira compartilhável por URL sem nenhum trabalho a mais.

Arquivo JSON e não banco: um tema é um documento, sempre lido e escrito inteiro,
e nunca serão milhares. SQLite aqui seria cerimônia sem benefício.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path

from ..config import settings
from .models import Bloco, Definicao, Tema

# Só o formato que este módulo emite. Um id que venha do cliente é usado para
# montar um caminho de arquivo, então tem de ser conferido antes — senão
# "../../etc/passwd" vira um caminho válido.
_ID_VALIDO = re.compile(r"^tema_[0-9a-f]{12}$")


class TemaInexistente(KeyError):
    pass


class Armazem:
    """Temas em disco, um arquivo por tema.

    A escrita é atômica (arquivo temporário e `os.replace`) porque um tema é
    reescrito inteiro a cada bloco fixado: uma interrupção no meio de um
    `write` deixaria o arquivo truncado e a investigação perdida.
    """

    def __init__(self, raiz: str | Path | None = None):
        self.raiz = Path(raiz or getattr(settings, "themes_dir", "data/temas"))
        self.raiz.mkdir(parents=True, exist_ok=True)
        # Um lock por processo. O servidor é single-writer na prática, e isto
        # basta para dois pedidos concorrentes não se sobrescreverem.
        self._lock = threading.Lock()

    # -- caminho ------------------------------------------------------------
    def _caminho(self, id_: str) -> Path:
        if not _ID_VALIDO.match(id_):
            raise TemaInexistente(id_)
        return self.raiz / f"{id_}.json"

    # -- leitura ------------------------------------------------------------
    def ler(self, id_: str) -> Tema:
        caminho = self._caminho(id_)
        if not caminho.exists():
            raise TemaInexistente(id_)
        return Tema.de_json(json.loads(caminho.read_text(encoding="utf-8")))

    def listar(self) -> list[Tema]:
        """Todos os temas, do mais recente para o mais antigo.

        Lê tudo — inclusive os blocos — e devolve os objetos completos. Quem
        chama decide se serializa com ou sem blocos; a lista da interface usa
        `com_blocos=False`.
        """
        temas: list[Tema] = []
        for caminho in self.raiz.glob("tema_*.json"):
            try:
                temas.append(Tema.de_json(json.loads(caminho.read_text(encoding="utf-8"))))
            except (json.JSONDecodeError, OSError):
                # Um arquivo corrompido não pode derrubar a listagem inteira.
                continue
        return sorted(temas, key=lambda t: t.atualizado_em, reverse=True)

    # -- escrita ------------------------------------------------------------
    def salvar(self, tema: Tema) -> Tema:
        tema.toca()
        caminho = self._caminho(tema.id)
        dados = json.dumps(tema.para_json(), ensure_ascii=False, indent=1)
        with self._lock:
            # Escreve ao lado e troca: `os.replace` é atômico no mesmo
            # sistema de arquivos, então nunca há um JSON pela metade em disco.
            fd, temporario = tempfile.mkstemp(dir=self.raiz, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(dados)
                os.replace(temporario, caminho)
            except BaseException:
                Path(temporario).unlink(missing_ok=True)
                raise
        return tema

    def criar(self, titulo: str = "", descricao: str = "") -> Tema:
        tema = Tema(titulo=titulo.strip() or "Nova investigação", descricao=descricao.strip())
        return self.salvar(tema)

    def apagar(self, id_: str) -> None:
        self._caminho(id_).unlink(missing_ok=True)

    # -- operações sobre o conteúdo -----------------------------------------
    def fixar(self, id_: str, bloco: Bloco) -> Tema:
        tema = self.ler(id_)
        tema.blocos.append(bloco)
        return self.salvar(tema)

    def desafixar(self, id_: str, bloco_id: str) -> Tema:
        tema = self.ler(id_)
        tema.blocos = [b for b in tema.blocos if b.id != bloco_id]
        return self.salvar(tema)

    def anotar(self, id_: str, bloco_id: str, anotacao: str) -> Tema:
        tema = self.ler(id_)
        bloco = tema.bloco(bloco_id)
        if bloco is None:
            raise TemaInexistente(bloco_id)
        bloco.anotacao = anotacao.strip()
        return self.salvar(tema)

    def reordenar(self, id_: str, ordem: list[str]) -> Tema:
        """Reordena pelos ids recebidos; o que não vier na lista fica no fim."""
        tema = self.ler(id_)
        posicao = {bid: i for i, bid in enumerate(ordem)}
        tema.blocos.sort(key=lambda b: posicao.get(b.id, len(posicao)))
        return self.salvar(tema)

    def definir(self, id_: str, definicao: Definicao) -> Tema:
        """Acrescenta ou substitui a definição de um termo no tema."""
        tema = self.ler(id_)
        tema.definicoes = [d for d in tema.definicoes if d.termo.lower() != definicao.termo.lower()]
        tema.definicoes.append(definicao)
        return self.salvar(tema)

    def remover_definicao(self, id_: str, termo: str) -> Tema:
        tema = self.ler(id_)
        tema.definicoes = [d for d in tema.definicoes if d.termo.lower() != termo.lower()]
        return self.salvar(tema)

    def renomear(self, id_: str, titulo: str, descricao: str | None = None) -> Tema:
        tema = self.ler(id_)
        if titulo.strip():
            tema.titulo = titulo.strip()
        if descricao is not None:
            tema.descricao = descricao.strip()
        return self.salvar(tema)
