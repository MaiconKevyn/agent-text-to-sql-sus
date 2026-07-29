"""Tipos do painel de indicadores. Sem I/O — só a forma dos dados.

Um PAINEL é o oposto de um tema, e a diferença não é de gosto:

  O bloco de um tema é CONGELADO. O SQL e o resultado ficam presos juntos para
  que um número citado num relatório continue citável daqui a um mês. Se um
  filtro pudesse mudá-lo depois, a citação apodreceria.

  O widget de um painel é VIVO. Ele guarda um SQL com marcadores e nenhum
  resultado: os números são recalculados a cada leitura, sob os filtros atuais.
  É o que faz o painel responder a "e se eu olhar só 2021?".

Por isso são dois objetos, com dois armazenamentos. Misturá-los quebraria a
garantia do tema — e um painel que não recalcula não é painel, é captura de
tela.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from .filtros import Filtro, TOKEN

# Um painel só mostra número. Texto e citação são coisa de tema — quem quer
# guardar o porquê de um achado quer um tema, não um mostrador.
FormatoWidget = Literal["grafico", "indicador"]

COLUNAS = 12
# A altura mínima caiu de 4 para 3 por causa do indicador compacto: sem rodapé
# e com o espaçamento apertado, título mais número cabem em três linhas da
# grade, e prender o widget em quatro deixaria um vazio que só existe porque o
# mínimo é antigo.
LARGURA_MIN, ALTURA_MIN = 3, 3
ALTURA_MAX = 40

# A base vai de agosto de 2007 a dezembro de 2023 (ver knowledge/schema.yaml).
ANO_MIN, ANO_MAX = 2007, 2024


# O indicador normal ocupa meia altura de um gráfico e mostra número, rótulo da
# coluna e o rodapé de detalhe. O compacto é o mesmo widget sem o rodapé e com o
# espaçamento apertado: quando o painel abre com quatro deles em fila, o que se
# quer ler é a fila de números, não quatro cartões.
EXIBICAO_PADRAO = {"compact": False, "scale": 1.0}

# O número do indicador tem 30px de base. Abaixo de 0,6 ele fica menor que o
# título e deixa de ser o assunto do cartão; acima de 2,2 não cabe em três
# colunas da grade sem estourar.
ESCALA_MIN, ESCALA_MAX = 0.6, 2.2


def exibicao_de(bruta) -> dict:
    """Só as chaves conhecidas, com o tipo e a faixa certos."""
    d = dict(EXIBICAO_PADRAO)
    if not isinstance(bruta, dict):
        return d
    if isinstance(bruta.get("compact"), bool):
        d["compact"] = bruta["compact"]
    try:
        escala = float(bruta.get("scale", 1.0))
        d["scale"] = round(max(ESCALA_MIN, min(ESCALA_MAX, escala)), 2)
    except (TypeError, ValueError):
        pass
    return d


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:12]}"


@dataclass
class Widget:
    """Uma consulta viva: SQL com marcadores, sem resultado guardado."""

    id: str = field(default_factory=lambda: _id("wgt"))
    titulo: str = ""
    pergunta: str = ""
    sql: str = ""
    # Os filtros que ESTE widget dispensa. Vazio — o padrão — significa que ele
    # obedece a todos, que é o que se espera de um painel: criar um filtro e ver
    # a tela inteira responder.
    #
    # A exceção existe porque nem todo recorte faz sentido em todo lugar: num
    # painel com "óbitos por sexo" ao lado de "total geral", filtrar o primeiro
    # por sexo o reduz a uma barra. Guardar a EXCEÇÃO, e não a lista do que
    # obedece, é o que faz um filtro novo já valer em todo widget sem que
    # ninguém precise marcá-lo um por um.
    excluidos: list[str] = field(default_factory=list)
    chart: dict | None = None
    formato: FormatoWidget = "grafico"
    suposicoes: list[str] = field(default_factory=list)
    # As escolhas do menu que produziram este widget — medida, eixo, série,
    # ordem, limite. Só existe em quem nasceu do menu, e é o que torna a edição
    # possível: sem ela, "editar" só poderia oferecer a aparência, porque não
    # haveria como saber que aquele SQL veio de "Óbitos por UF, 15 categorias".
    #
    # Um widget escrito por modelo não tem montagem e não vai ter: reconstruir
    # as escolhas a partir do SQL seria adivinhação, e adivinhação errada aqui
    # troca silenciosamente o que o gráfico mede.
    montagem: dict | None = None
    # Como o widget se mostra. Hoje só interessa ao indicador: `compacto` tira o
    # rodapé e aperta o espaçamento, `escala` multiplica o tamanho do número.
    exibicao: dict = field(default_factory=dict)
    x: int = -1
    y: int = -1
    largura: int = 6
    altura: int = 10
    criado_em: str = field(default_factory=_agora)

    @property
    def legado(self) -> bool:
        """Widget criado antes dos filtros declarados: não tem o token.

        Não é apagado nem consertado por adivinhação — a tela oferece recriá-lo
        a partir da pergunta original, que ficou guardada justamente para isto.
        """
        return TOKEN not in self.sql

    def para_json(self) -> dict:
        return {
            "id": self.id,
            "title": self.titulo,
            "question": self.pergunta,
            "sql": self.sql,
            "legacy": self.legado,
            "excluded": self.excluidos,
            "chart": self.chart,
            "format": self.formato,
            "assumptions": self.suposicoes,
            "build": self.montagem,
            "display": self.exibicao or EXIBICAO_PADRAO,
            "x": self.x,
            "y": self.y,
            "width": self.largura,
            "height": self.altura,
            "createdAt": self.criado_em,
        }

    @classmethod
    def de_json(cls, d: dict) -> Widget:
        return cls(
            id=str(d.get("id") or _id("wgt")),
            titulo=str(d.get("title") or ""),
            pergunta=str(d.get("question") or ""),
            sql=str(d.get("sql") or ""),
            chart=d.get("chart"),
            formato=d.get("format") if d.get("format") in ("grafico", "indicador") else "grafico",
            suposicoes=list(d.get("assumptions") or []),
            montagem=d.get("build") if isinstance(d.get("build"), dict) else None,
            exibicao=exibicao_de(d.get("display")),
            excluidos=[str(x) for x in (d.get("excluded") or [])],
            x=int(d.get("x", -1)),
            y=int(d.get("y", -1)),
            largura=max(LARGURA_MIN, min(COLUNAS, int(d.get("width") or 6))),
            altura=max(ALTURA_MIN, min(ALTURA_MAX, int(d.get("height") or 10))),
            criado_em=str(d.get("createdAt") or _agora()),
        )


@dataclass
class Painel:
    id: str = field(default_factory=lambda: _id("dash"))
    titulo: str = "Novo painel"
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)
    # Os filtros ficam NO PAINEL, não na sessão: abrir o link do painel tem de
    # mostrar o mesmo recorte para quem abriu e para quem recebeu.
    filtros: list[Filtro] = field(default_factory=list)
    widgets: list[Widget] = field(default_factory=list)

    def toca(self) -> None:
        self.atualizado_em = _agora()

    def widget(self, id_: str) -> Widget | None:
        return next((w for w in self.widgets if w.id == id_), None)

    def filtro(self, id_: str) -> Filtro | None:
        return next((f for f in self.filtros if f.id == id_), None)

    def para_json(self, *, com_widgets: bool = True) -> dict:
        base = {
            "id": self.id,
            "title": self.titulo,
            "createdAt": self.criado_em,
            "updatedAt": self.atualizado_em,
            "filters": [f.para_json() for f in self.filtros],
            "widgetCount": len(self.widgets),
        }
        if com_widgets:
            base["widgets"] = [w.para_json() for w in self.widgets]
        return base

    @classmethod
    def de_json(cls, d: dict) -> Painel:
        widgets = [Widget.de_json(x) for x in (d.get("widgets") or [])]
        acomodar(widgets)
        # Painel salvo antes dos filtros declarados guardava `filters` como um
        # OBJETO — os três filtros fixos de então. Iterar um dicionário devolve
        # as chaves, e o construtor de Filtro estoura numa string.
        #
        # Aqueles filtros não têm conversão: eles não carregavam fragmento SQL
        # nem domínio, que é o que um filtro declarado é. O painel abre sem
        # filtro nenhum e mantém os widgets — perder o recorte é recuperável em
        # um clique; perder o painel, não.
        brutos = d.get("filters")
        filtros = [
            Filtro.de_json(x) for x in (brutos if isinstance(brutos, list) else []) if isinstance(x, dict)
        ]
        return cls(
            id=str(d.get("id") or _id("dash")),
            titulo=str(d.get("title") or "Novo painel"),
            criado_em=str(d.get("createdAt") or _agora()),
            atualizado_em=str(d.get("updatedAt") or _agora()),
            filtros=filtros,
            widgets=widgets,
        )


def acomodar(widgets: list[Widget]) -> None:
    """Dá posição a quem ainda não tem, sem mexer em quem já tem."""
    colocados = [w for w in widgets if w.x >= 0 and w.y >= 0]

    def livre(x: int, y: int, w: int, h: int) -> bool:
        return not any(
            x < c.x + c.largura and x + w > c.x and y < c.y + c.altura and y + h > c.y
            for c in colocados
        )

    for wid in widgets:
        if wid.x >= 0 and wid.y >= 0:
            continue
        largura = min(wid.largura, COLUNAS)
        y = 0
        while True:
            for x in range(0, COLUNAS - largura + 1):
                if livre(x, y, largura, wid.altura):
                    wid.x, wid.y = x, y
                    colocados.append(wid)
                    break
            if wid.x >= 0:
                break
            y += 1
