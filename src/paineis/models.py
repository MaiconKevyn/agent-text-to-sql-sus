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

# Os filtros que existem, e nada além disso. Cada um mapeia para uma coluna de
# semântica conhecida do dicionário de dados. Filtro livre seria armadilha: o
# usuário pediria "por hospital" e receberia silêncio, porque a base não tem
# identificação de hospital.
Filtro = Literal["periodo", "diagnostico", "uf"]

# Quantos `?` cada filtro ocupa no SQL. É o contrato entre o SQL que o modelo
# escreve e os valores que o código vincula: a ordem de `filtros` no widget é a
# ordem dos marcadores na query.
MARCADORES: dict[str, int] = {"periodo": 2, "diagnostico": 1, "uf": 1}

# Um painel só mostra número. Texto e citação são coisa de tema — quem quer
# guardar o porquê de um achado quer um tema, não um mostrador.
FormatoWidget = Literal["grafico", "indicador"]

COLUNAS = 12
LARGURA_MIN, ALTURA_MIN = 3, 4
ALTURA_MAX = 40

# A base vai de agosto de 2007 a dezembro de 2023 (ver knowledge/schema.yaml).
ANO_MIN, ANO_MAX = 2007, 2024


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
    # A quais filtros ESTE widget responde, na ordem em que os `?` aparecem no
    # SQL. Um widget sem coluna de data não lista "periodo" — e a interface tem
    # de MOSTRAR isso. Um filtro que silenciosamente vale para metade do painel
    # é pior que filtro nenhum: a pessoa move a data, vê três gráficos mudarem e
    # dois não, e conclui que os dois não mudaram por causa do dado.
    filtros: list[str] = field(default_factory=list)
    chart: dict | None = None
    formato: FormatoWidget = "grafico"
    suposicoes: list[str] = field(default_factory=list)
    x: int = -1
    y: int = -1
    largura: int = 6
    altura: int = 10
    criado_em: str = field(default_factory=_agora)

    def responde_a(self, filtro: str) -> bool:
        return filtro in self.filtros

    def para_json(self) -> dict:
        return {
            "id": self.id,
            "title": self.titulo,
            "question": self.pergunta,
            "sql": self.sql,
            "filters": self.filtros,
            "chart": self.chart,
            "format": self.formato,
            "assumptions": self.suposicoes,
            "x": self.x,
            "y": self.y,
            "width": self.largura,
            "height": self.altura,
            "createdAt": self.criado_em,
        }

    @classmethod
    def de_json(cls, d: dict) -> Widget:
        filtros = [f for f in (d.get("filters") or []) if f in MARCADORES]
        return cls(
            id=str(d.get("id") or _id("wgt")),
            titulo=str(d.get("title") or ""),
            pergunta=str(d.get("question") or ""),
            sql=str(d.get("sql") or ""),
            filtros=filtros,
            chart=d.get("chart"),
            formato=d.get("format") if d.get("format") in ("grafico", "indicador") else "grafico",
            suposicoes=list(d.get("assumptions") or []),
            x=int(d.get("x", -1)),
            y=int(d.get("y", -1)),
            largura=max(LARGURA_MIN, min(COLUNAS, int(d.get("width") or 6))),
            altura=max(ALTURA_MIN, min(ALTURA_MAX, int(d.get("height") or 10))),
            criado_em=str(d.get("createdAt") or _agora()),
        )


@dataclass
class Filtros:
    """Os valores atuais. Vazio significa "tudo" — não significa "nenhum"."""

    ano_ini: int = ANO_MIN
    ano_fim: int = ANO_MAX
    # Prefixo de CID-10: "C" pega o capítulo de neoplasias, "C50" a mama,
    # "" pega tudo. Prefixo e não lista porque é assim que a CID se organiza,
    # e é o recorte que o dicionário de dados já ensina o modelo a usar.
    diagnostico: str = ""
    uf: str = ""

    def valores(self, filtro: str) -> list:
        """Os valores a vincular, na ordem dos `?` daquele filtro."""
        if filtro == "periodo":
            return [self.ano_ini, self.ano_fim]
        # Vazio significa TUDO, e por isso os dois viram `%` — que só funciona
        # com LIKE. Com `=`, o vazio viraria `SG_UF = ''`, que não casa com
        # nada: o widget devolveria zero linhas em qualquer filtro, e zero
        # linhas parece "não há dado", não parece defeito. Foi o que aconteceu
        # na primeira versão.
        if filtro == "diagnostico":
            return [f"{self.diagnostico}%"]
        if filtro == "uf":
            return [self.uf or "%"]
        return []

    def para_json(self) -> dict:
        return {
            "yearFrom": self.ano_ini,
            "yearTo": self.ano_fim,
            "diagnosis": self.diagnostico,
            "uf": self.uf,
        }

    @classmethod
    def de_json(cls, d: dict) -> Filtros:
        ini = max(ANO_MIN, min(ANO_MAX, int(d.get("yearFrom") or ANO_MIN)))
        fim = max(ANO_MIN, min(ANO_MAX, int(d.get("yearTo") or ANO_MAX)))
        return cls(
            ano_ini=min(ini, fim),
            ano_fim=max(ini, fim),
            # Só letra e dígito: o valor vai vinculado, não concatenado, mas um
            # prefixo com `%` no meio viraria um LIKE que ninguém pediu.
            diagnostico="".join(c for c in str(d.get("diagnosis") or "") if c.isalnum())[:4].upper(),
            uf="".join(c for c in str(d.get("uf") or "") if c.isalpha())[:2].upper(),
        )


@dataclass
class Painel:
    id: str = field(default_factory=lambda: _id("dash"))
    titulo: str = "Novo painel"
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)
    # Os filtros ficam NO PAINEL, não na sessão: abrir o link do painel tem de
    # mostrar o mesmo recorte para quem abriu e para quem recebeu.
    filtros: Filtros = field(default_factory=Filtros)
    widgets: list[Widget] = field(default_factory=list)

    def toca(self) -> None:
        self.atualizado_em = _agora()

    def widget(self, id_: str) -> Widget | None:
        return next((w for w in self.widgets if w.id == id_), None)

    def para_json(self, *, com_widgets: bool = True) -> dict:
        base = {
            "id": self.id,
            "title": self.titulo,
            "createdAt": self.criado_em,
            "updatedAt": self.atualizado_em,
            "filters": self.filtros.para_json(),
            "widgetCount": len(self.widgets),
        }
        if com_widgets:
            base["widgets"] = [w.para_json() for w in self.widgets]
        return base

    @classmethod
    def de_json(cls, d: dict) -> Painel:
        widgets = [Widget.de_json(x) for x in (d.get("widgets") or [])]
        acomodar(widgets)
        return cls(
            id=str(d.get("id") or _id("dash")),
            titulo=str(d.get("title") or "Novo painel"),
            criado_em=str(d.get("createdAt") or _agora()),
            atualizado_em=str(d.get("updatedAt") or _agora()),
            filtros=Filtros.de_json(d.get("filters") or {}),
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
