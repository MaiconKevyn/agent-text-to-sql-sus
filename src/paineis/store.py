"""Armazenamento dos painéis. Um arquivo JSON por painel, como os temas.

Separado do armazém de temas de propósito: são objetos com ciclos de vida
diferentes, e um `Documentos[T]` por tipo mantém os prefixos de id distintos —
`dash_` e `tema_` — o que faz um id trocado falhar alto em vez de ler o
documento errado.
"""

from __future__ import annotations

from pathlib import Path

from ..config import settings
from ..storage import DocumentoInexistente, Documentos
from .models import ALTURA_MAX, ALTURA_MIN, COLUNAS, LARGURA_MIN, Filtros, Painel, Widget


class PainelInexistente(DocumentoInexistente):
    pass


class Paineis:
    def __init__(self, raiz: str | Path | None = None):
        self._docs: Documentos[Painel] = Documentos(
            raiz or getattr(settings, "dashboards_dir", "data/paineis"),
            prefixo="dash",
            de_json=Painel.de_json,
            para_json=lambda p: p.para_json(),
            id_de=lambda p: p.id,
            chave_ordem=lambda p: p.atualizado_em,
        )

    def ler(self, id_: str) -> Painel:
        try:
            return self._docs.ler(id_)
        except DocumentoInexistente as e:
            raise PainelInexistente(id_) from e

    def listar(self) -> list[Painel]:
        return self._docs.listar()

    def salvar(self, painel: Painel) -> Painel:
        painel.toca()
        return self._docs.salvar(painel)

    def criar(self, titulo: str = "") -> Painel:
        return self.salvar(Painel(titulo=titulo.strip() or "Novo painel"))

    def apagar(self, id_: str) -> None:
        self._docs.apagar(id_)

    # -- conteúdo ------------------------------------------------------------
    def acrescentar(self, id_: str, widget: Widget) -> Painel:
        painel = self.ler(id_)
        painel.widgets.append(widget)
        return self.salvar(painel)

    def remover(self, id_: str, widget_id: str) -> Painel:
        painel = self.ler(id_)
        painel.widgets = [w for w in painel.widgets if w.id != widget_id]
        return self.salvar(painel)

    def filtrar(self, id_: str, filtros: dict) -> Painel:
        """Troca os valores dos filtros. Eles ficam no painel, não na sessão."""
        painel = self.ler(id_)
        painel.filtros = Filtros.de_json(filtros)
        return self.salvar(painel)

    def dispor(self, id_: str, arranjo: list[dict]) -> Painel:
        """A grade inteira de uma vez — mesma razão do tema: um movimento
        reposiciona vários, e gravar um por vez passaria por estados
        sobrepostos."""
        painel = self.ler(id_)
        por_id = {w.id: w for w in painel.widgets}
        for item in arranjo:
            w = por_id.get(str(item.get("id")))
            if w is None:
                continue
            w.largura = max(LARGURA_MIN, min(COLUNAS, int(item.get("width", w.largura))))
            w.altura = max(ALTURA_MIN, min(ALTURA_MAX, int(item.get("height", w.altura))))
            w.x = max(0, min(COLUNAS - w.largura, int(item.get("x", w.x))))
            w.y = max(0, int(item.get("y", w.y)))
        painel.widgets.sort(key=lambda w: (w.y, w.x))
        return self.salvar(painel)

    def renomear(self, id_: str, titulo: str) -> Painel:
        painel = self.ler(id_)
        if titulo.strip():
            painel.titulo = titulo.strip()[:120]
        return self.salvar(painel)
