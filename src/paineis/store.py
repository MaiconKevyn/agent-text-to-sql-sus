"""Armazenamento dos painéis. Um arquivo JSON por painel, como os temas.

Separado do armazém de temas de propósito: são objetos com ciclos de vida
diferentes, e um `Documentos[T]` por tipo mantém os prefixos de id distintos —
`dash_` e `tema_` — o que faz um id trocado falhar alto em vez de ler o
documento errado.
"""

from __future__ import annotations

import re
from pathlib import Path

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

from ..config import settings
from ..storage import DocumentoInexistente, Documentos
from .filtros import Filtro
from .models import ALTURA_MAX, ALTURA_MIN, COLUNAS, LARGURA_MIN, Painel, Widget


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

    def acrescentar_filtro(self, id_: str, filtro: Filtro) -> Painel:
        painel = self.ler(id_)
        painel.filtros.append(filtro)
        return self.salvar(painel)

    def remover_filtro(self, id_: str, filtro_id: str) -> Painel:
        painel = self.ler(id_)
        painel.filtros = [f for f in painel.filtros if f.id != filtro_id]
        return self.salvar(painel)

    def selecionar(self, id_: str, filtro_id: str, selecao: list) -> Painel:
        """Troca o que está selecionado num filtro. Fica no painel, não na sessão."""
        painel = self.ler(id_)
        f = painel.filtro(filtro_id)
        if f is None:
            raise PainelInexistente(filtro_id)
        # Só valores que existem no domínio: um valor inventado não filtraria
        # nada e pareceria "não há dado".
        if f.tipo == "data":
            # Data ISO, dentro dos limites lidos do banco. Uma data fora deles
            # não é erro de digitação inofensivo: recortar de 1990 a 1995 numa
            # base que começa em 2007 devolve zero linhas, e zero linhas na tela
            # se lê como "não houve".
            datas = sorted(
                v
                for v in selecao
                if isinstance(v, str) and _ISO.match(v) and str(f.minimo) <= v <= str(f.maximo)
            )[:2]
            f.selecao = datas if len(datas) == 2 else f.selecao
        elif f.tipo == "faixa":
            nums = [v for v in selecao if isinstance(v, (int, float))][:2]
            f.selecao = sorted(int(v) for v in nums) if len(nums) == 2 else f.selecao
        else:
            validos = {o.valor for o in f.opcoes}
            f.selecao = [v for v in selecao if v in validos]
        return self.salvar(painel)

    def alternar_filtro_do_widget(self, id_: str, widget_id: str, filtro_id: str) -> Painel:
        """Liga ou desliga um filtro NAQUELE widget."""
        painel = self.ler(id_)
        w = painel.widget(widget_id)
        if w is None or painel.filtro(filtro_id) is None:
            raise PainelInexistente(f"{widget_id}/{filtro_id}")
        if filtro_id in w.excluidos:
            w.excluidos.remove(filtro_id)
        else:
            w.excluidos.append(filtro_id)
        return self.salvar(painel)

    def restringir_filtro(self, id_: str, filtro_id: str, apenas: list[str]) -> Painel:
        """Faz um filtro valer só nos widgets pedidos, excluindo-o dos demais.

        É o caminho de "aplique esse filtro só no gráfico de óbitos": o filtro
        continua sendo do painel, e a restrição vive nos widgets — assim um
        widget novo nasce obedecendo, que é o padrão certo.
        """
        painel = self.ler(id_)
        alvo = set(apenas)
        for w in painel.widgets:
            if w.id in alvo:
                if filtro_id in w.excluidos:
                    w.excluidos.remove(filtro_id)
            elif filtro_id not in w.excluidos:
                w.excluidos.append(filtro_id)
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
