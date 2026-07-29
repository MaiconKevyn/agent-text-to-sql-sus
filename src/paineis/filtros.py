"""Filtros declarados: o usuário pede, o modelo declara, o código executa.

A primeira versão tinha três filtros fixos num `Literal`. O argumento era bom —
filtro livre convida "por hospital", que a base não tem — mas ele não sustenta
"acrescente um filtro por sexo, onde eu possa escolher um ou os dois". A saída
não é abrir para qualquer texto: é o filtro continuar ANCORADO numa coluna real,
só que declarado em tempo de uso em vez de escrito no código.

Três decisões que fazem isso funcionar:

  FRAGMENTO AUTOSSUFICIENTE. O filtro carrega uma expressão booleana que se
  basta — `i.SEXO = ANY(?)`, ou, para UF,
  `i.MUNIC_RES IN (SELECT CO_MUNICIPIO_6D FROM municipios WHERE SG_UF = ?)`.
  Assim ele vale para QUALQUER widget, inclusive os que não fazem o join. Sem
  isso, "vale para todos os gráficos" seria mentira para metade deles.

  FILTRO INATIVO NÃO ENTRA NA CONSULTA. Nada de vincular um curinga: se a
  seleção cobre tudo, o fragmento não é injetado. Isso mata de raiz o defeito da
  versão anterior, em que `SG_UF = ''` deixava o widget permanentemente vazio
  sem nunca dar erro.

  AS OPÇÕES VÊM DO BANCO. Um filtro de sexo com as opções escritas à mão
  mostraria "Masculino/Feminino"; o banco tem 1 e 3, e ainda pode ter 0 e 9. As
  opções são lidas uma vez, na criação, com a contagem de cada uma.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

# Como o widget marca onde a conjunção dos filtros entra. Um token e não `?`
# porque a quantidade de condições muda a cada leitura.
TOKEN = "{{FILTROS}}"

TIPOS = ("faixa", "data", "escolha", "multipla")

# Os dois controles de intervalo. Compartilham quase tudo — dois limites, dois
# `?`, seleção de dois valores —, e a única diferença é o tipo que atravessa o
# JSON: número em `faixa`, texto ISO em `data`.
#
# Existem separados porque `faixa` nasceu convertendo os limites com `int()`, e
# um pedido perfeitamente correto — "i.DT_SAIDA BETWEEN ? AND ?", com domínio
# devolvendo min e max da coluna — morria em `int(date(2007, 8, 1))` com a
# mensagem "não devolveu dois números". O modelo tinha acertado; o sistema é que
# não sabia falar data.
INTERVALOS = ("faixa", "data")


@dataclass
class Opcao:
    valor: Any
    rotulo: str
    n: int = 0

    def para_json(self) -> dict:
        return {"value": self.valor, "label": self.rotulo, "count": self.n}

    @classmethod
    def de_json(cls, d: dict) -> Opcao:
        return cls(valor=d.get("value"), rotulo=str(d.get("label") or ""), n=int(d.get("count") or 0))


@dataclass
class Filtro:
    id: str = field(default_factory=lambda: f"flt_{uuid.uuid4().hex[:8]}")
    rotulo: str = ""
    tipo: str = "escolha"
    # A expressão booleana, com `?`. Precisa se bastar: só `i.<coluna>` e
    # subconsultas. Nada de depender de join que o widget talvez não tenha.
    fragmento: str = ""
    # Para `faixa` e `data`: os limites que o banco tem de fato. Número num
    # caso, data ISO ('2007-08-01') no outro.
    minimo: int | str | None = None
    maximo: int | str | None = None
    # Para `escolha` e `multipla`: o domínio, lido do banco.
    opcoes: list[Opcao] = field(default_factory=list)
    # O que está selecionado agora. Faixa: [ini, fim]. Escolha: [v]. Múltipla:
    # [v1, v2]. Lista vazia significa "tudo" — e "tudo" não filtra nada.
    selecao: list = field(default_factory=list)
    # Uma frase do modelo sobre o que a coluna significa nesta base. Aparece
    # como dica: "SEXO 1 é masculino e 3 é feminino" não é adivinhável.
    nota: str = ""
    # O campo do catálogo, quando o filtro veio do menu. É o que faz a edição
    # abrir com a coluna certa já escolhida. Um filtro declarado por modelo não
    # tem — e a edição dele começa com a coluna em branco, dizendo isso, em vez
    # de adivinhar a partir do fragmento.
    campo: str = ""

    @property
    def ativo(self) -> bool:
        """Se este filtro está de fato recortando algo."""
        if not self.selecao:
            return False
        if self.tipo in INTERVALOS:
            return [self.minimo, self.maximo] != list(self.selecao)
        # Seleção que cobre todas as opções é o mesmo que nenhuma seleção.
        return len(self.selecao) < len(self.opcoes) if self.opcoes else True

    def valores(self) -> list:
        """Os valores a vincular, na ordem dos `?` do fragmento."""
        if self.tipo in INTERVALOS:
            # Data vai como texto ISO: o DuckDB compara VARCHAR com DATE sem
            # reclamar, e mandar um `datetime.date` obrigaria o filtro a
            # carregar um tipo que o JSON do painel não sabe guardar.
            return list(self.selecao[:2])
        if self.tipo == "multipla":
            # Um único parâmetro, que É a lista: `= ANY(?)`.
            return [list(self.selecao)]
        return [self.selecao[0]]

    def para_json(self) -> dict:
        return {
            "id": self.id,
            "label": self.rotulo,
            "kind": self.tipo,
            "fragment": self.fragmento,
            "min": self.minimo,
            "max": self.maximo,
            "options": [o.para_json() for o in self.opcoes],
            "selection": self.selecao,
            "note": self.nota,
            "field": self.campo,
            "active": self.ativo,
        }

    @classmethod
    def de_json(cls, d: dict) -> Filtro:
        return cls(
            id=str(d.get("id") or f"flt_{uuid.uuid4().hex[:8]}"),
            rotulo=str(d.get("label") or ""),
            tipo=d.get("kind") if d.get("kind") in TIPOS else "escolha",
            fragmento=str(d.get("fragment") or ""),
            minimo=d.get("min"),
            maximo=d.get("max"),
            opcoes=[Opcao.de_json(o) for o in (d.get("options") or [])],
            selecao=list(d.get("selection") or []),
            nota=str(d.get("note") or ""),
            campo=str(d.get("field") or ""),
        )


def montar_clausula(filtros: list[Filtro], excluidos: list[str] | None = None) -> tuple[str, list]:
    """A conjunção dos filtros ATIVOS, e os valores na ordem dos `?`.

    Devolve string vazia quando nada está ativo — e aí o token some do SQL sem
    deixar `AND` solto. É o caminho mais comum e o mais fácil de quebrar.
    """
    fora = set(excluidos or [])
    ativos = [f for f in filtros if f.ativo and f.fragmento and f.id not in fora]
    if not ativos:
        return "", []
    partes = " AND ".join(f"({f.fragmento})" for f in ativos)
    valores = [v for f in ativos for v in f.valores()]
    return f" AND {partes}", valores


def aplicar(
    sql: str, filtros: list[Filtro], excluidos: list[str] | None = None
) -> tuple[str, list]:
    """Troca o token pela conjunção. SQL sem token não recebe filtro nenhum."""
    clausula, valores = montar_clausula(filtros, excluidos)
    if TOKEN not in sql:
        return sql, []
    return sql.replace(TOKEN, clausula), valores
