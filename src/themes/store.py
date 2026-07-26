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

from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from ..config import settings
from ..storage import DocumentoInexistente, Documentos
from .models import Bloco, Definicao, Tema


class TemaInexistente(DocumentoInexistente):
    pass


class Armazem:
    """Temas em disco, um arquivo por tema.

    A escrita é atômica (arquivo temporário e `os.replace`) porque um tema é
    reescrito inteiro a cada bloco fixado: uma interrupção no meio de um
    `write` deixaria o arquivo truncado e a investigação perdida.
    """

    def __init__(self, raiz: str | Path | None = None):
        self._docs: Documentos[Tema] = Documentos(
            raiz or getattr(settings, "themes_dir", "data/temas"),
            prefixo="tema",
            de_json=Tema.de_json,
            para_json=lambda t: t.para_json(),
            id_de=lambda t: t.id,
            chave_ordem=lambda t: t.atualizado_em,
        )

    def ler(self, id_: str) -> Tema:
        try:
            return self._docs.ler(id_)
        except DocumentoInexistente as e:
            raise TemaInexistente(id_) from e

    def listar(self) -> list[Tema]:
        """Todos os temas, do mais recente para o mais antigo.

        Devolve os objetos completos; quem chama decide se serializa com ou sem
        blocos. A lista da interface usa `com_blocos=False`.
        """
        return self._docs.listar()

    def salvar(self, tema: Tema) -> Tema:
        tema.toca()
        return self._docs.salvar(tema)

    def criar(self, titulo: str = "", descricao: str = "") -> Tema:
        tema = Tema(titulo=titulo.strip() or "Nova investigação", descricao=descricao.strip())
        return self.salvar(tema)

    def apagar(self, id_: str) -> None:
        self._docs.apagar(id_)

    # -- operações sobre o conteúdo -----------------------------------------
    def fixar(self, id_: str, bloco: Bloco) -> Tema:
        tema = self.ler(id_)
        _sanear_fonte(bloco)
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

    def formatar(
        self, id_: str, bloco_id: str, *, formato: str | None = None, tamanho: str | None = None
    ) -> Tema:
        """Ajusta a apresentação de um bloco no painel.

        Valores fora dos previstos são ignorados em silêncio em vez de virarem
        erro: o pedido vem do cliente, e um valor desconhecido é ruído, não
        motivo para recusar a operação inteira.
        """
        tema = self.ler(id_)
        bloco = tema.bloco(bloco_id)
        if bloco is None:
            raise TemaInexistente(bloco_id)
        if formato in ("auto", "indicador", "grafico", "tabela", "citacao"):
            bloco.formato = formato  # type: ignore[assignment]
        if tamanho in ("p", "m", "g"):
            bloco.tamanho = tamanho  # type: ignore[assignment]
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


# Esquemas que viram link clicável no relatório. `javascript:` e `data:` ficam
# de fora: a URL vem do usuário, e um href com `javascript:` executa no clique.
_ESQUEMAS = ("http", "https")


def _sanear_fonte(bloco: Bloco) -> None:
    """Confere a URL do bloco externo e carimba a data de acesso.

    A data é do SERVIDOR, não do cliente: ela existe para dizer quando o texto
    foi lido, e um valor que o cliente escolhe não serve para isso.
    """
    if bloco.procedencia == "banco":
        bloco.fonte_url = ""
        bloco.fonte_titulo = ""
        bloco.acessado_em = ""
        return

    url = (bloco.fonte_url or "").strip()
    if url:
        partes = urlparse(url)
        if partes.scheme not in _ESQUEMAS or not partes.netloc:
            url = ""
    bloco.fonte_url = url
    # Sem URL não é fonte externa conferível — é anotação de quem investiga.
    if not url and bloco.procedencia == "web":
        bloco.procedencia = "usuario"
    bloco.acessado_em = bloco.acessado_em or date.today().isoformat()
