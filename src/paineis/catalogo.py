"""O catálogo: os campos e as medidas que o painel oferece no menu manual.

Existe porque o menu manual não tem modelo nenhum no caminho. Quando a pessoa
escreve "óbitos por UF", um modelo lê o dicionário do banco e escreve o SQL, e o
código confere. Quando ela escolhe "Óbitos" e "UF" em dois menus, não há a quem
conferir — então o SQL precisa vir de algo que já esteja certo antes de alguém
clicar.

Este arquivo é esse algo. Cada campo carrega quatro coisas que o
`knowledge/schema.yaml` documenta e que ninguém acerta por adivinhação:

  O MOLDE DO FILTRO, que tem de se bastar — só `i.<coluna>` e subconsultas,
  nunca um join, porque o fragmento é colado dentro de widgets que talvez não
  tenham aquele join.

  O RÓTULO LEGÍVEL, que quase sempre mora em outra tabela. SEXO é 1 e 3 no fato;
  quem lê o eixo quer "Masculino" e "Feminino". As duas expressões são distintas
  de propósito: o filtro compara código, o eixo mostra descrição.

  A SANIDADE. IDADE tem registro até 130 e a faixa plausível vai a 120; DT_SAIDA
  tem nulo. Deixar isso para quem monta o gráfico é garantir que metade dos
  gráficos manuais nasça com lixo dentro.

  O QUE NÃO SE DEVE OFERECER. GESTRISCO está corrompida (TRUE em 99,6% das
  linhas, inclusive em 58,8 milhões de homens), UTI_INT_TO é zero em todas as
  linhas menos 29, `hospital` está vazia. Um campo que não está aqui não aparece
  no menu — e essa é a forma mais barata de impedir um gráfico errado: não
  deixar que ele seja montável.
"""

from __future__ import annotations

from dataclasses import dataclass

# Os tipos de controle, iguais aos de `filtros.py`.
FAIXA, ESCOLHA, MULTIPLA = "faixa", "escolha", "multipla"

# Como cada tipo compara. O molde do campo recebe isto em `{cmp}`.
COMPARACAO = {
    FAIXA: "BETWEEN ? AND ?",
    MULTIPLA: "= ANY(?)",
    ESCOLHA: "= ?",
}

# Acima disto um campo não pode virar série: doze cores já são o limite de uma
# legenda legível, e nenhuma paleta separa vinte.
TETO_SERIE = 12


@dataclass(frozen=True)
class Campo:
    """Uma coluna oferecida no menu — para filtrar, para agrupar, ou ambos."""

    id: str
    rotulo: str
    grupo: str
    # A expressão de agrupamento sobre o fato `i`, sem depender de join.
    chave: str
    tipo: str  # "categoria" | "numero"
    # Tipos de controle oferecidos. Vazio = o campo só serve para agrupar.
    filtros: tuple[str, ...] = ()
    # O molde do fragmento, com `{cmp}` onde entra a comparação. Vazio usa
    # `({chave}) {cmp}` — os parênteses importam: sem eles,
    # `i.MARCA_UTI > 0 = ?` é sintaxe inválida.
    molde: str = ""
    # A expressão que aparece no eixo. Vazia = usa a chave.
    rotulo_sql: str = ""
    # O join que `rotulo_sql` exige. Sempre LEFT: um código órfão vira NULL em
    # vez de sumir da contagem — `cid` tem 777 órfãos no fato, `procedimentos`
    # tem 370.
    junta: str = ""
    # SELECT das opções (valor, rótulo, contagem) ou dos limites (min, max).
    dominio: str = ""
    # Condição de sanidade que todo widget agrupado por este campo carrega.
    condicao: str = ""
    # Quantos valores distintos existem. 0 = muitos; a tela impõe um limite.
    distintos: int = 0
    nota: str = ""
    # Séries temporais e faixas ordenam pela categoria, não pelo valor.
    ordinal: bool = False

    @property
    def expr_rotulo(self) -> str:
        return self.rotulo_sql or self.chave

    @property
    def serve_serie(self) -> bool:
        return 0 < self.distintos <= TETO_SERIE

    def fragmento(self, tipo: str) -> str:
        """O fragmento pronto para este tipo de controle."""
        molde = self.molde or f"({self.chave}) {{cmp}}"
        return molde.format(cmp=COMPARACAO[tipo])

    def para_json(self) -> dict:
        return {
            "id": self.id,
            "label": self.rotulo,
            "group": self.grupo,
            "type": self.tipo,
            "filters": list(self.filtros),
            "distinct": self.distintos,
            "note": self.nota,
            "canSeries": self.serve_serie,
            "ordinal": self.ordinal,
        }


@dataclass(frozen=True)
class Medida:
    """O que vai no eixo do valor."""

    id: str
    rotulo: str
    expr: str
    alias: str
    # Sufixo da unidade. "%" e "R$" mudam como o número se lê.
    unidade: str = ""
    # Mínimo de casos no grupo. Só para taxas: um ranking de mortalidade sem
    # piso põe no topo o grupo de três internações com 100%, que é ruído.
    minimo_casos: int = 0
    nota: str = ""

    def para_json(self) -> dict:
        return {
            "id": self.id,
            "label": self.rotulo,
            "unit": self.unidade,
            "minCases": self.minimo_casos,
            "note": self.nota,
        }


# --------------------------------------------------------------------------- #
# Junções. Alias curto e fixo, para poderem se compor num mesmo FROM.
# --------------------------------------------------------------------------- #
J_MUN = "LEFT JOIN municipios mu ON mu.CO_MUNICIPIO_6D = i.MUNIC_RES"
J_CID = "LEFT JOIN cid cd ON cd.CID = i.DIAG_PRINC"
J_PROC = "LEFT JOIN procedimentos pc ON pc.PROC_REA = i.PROC_REA"
J_SEXO = "LEFT JOIN sexo sx ON sx.SEXO = i.SEXO"
J_RACA = "LEFT JOIN raca_cor rc ON rc.RACA_COR = i.RACA_COR"
J_CAR = "LEFT JOIN car_int ci ON ci.CAR_INT = i.CAR_INT"
J_ESPEC = "LEFT JOIN especialidade ep ON ep.ESPEC = i.ESPEC"
J_COMPLEX = "LEFT JOIN complexidade cx ON cx.COMPLEX = i.COMPLEX"
J_UTI = "LEFT JOIN marca_uti ut ON ut.MARCA_UTI = i.MARCA_UTI"

# A base não tem coluna de região; a macrorregião sai da UF. Escrita uma vez
# para o rótulo e o filtro nunca discordarem sobre a que região é o Acre.
REGIAO = """CASE
  WHEN {uf} IN ('AC','AP','AM','PA','RO','RR','TO') THEN 'Norte'
  WHEN {uf} IN ('AL','BA','CE','MA','PB','PE','PI','RN','SE') THEN 'Nordeste'
  WHEN {uf} IN ('DF','GO','MT','MS') THEN 'Centro-Oeste'
  WHEN {uf} IN ('ES','MG','RJ','SP') THEN 'Sudeste'
  WHEN {uf} IN ('PR','RS','SC') THEN 'Sul'
END"""

FAIXA_ETARIA = """CASE
  WHEN i.IDADE < 1 THEN '0 · menos de 1 ano'
  WHEN i.IDADE < 5 THEN '1 · 1 a 4'
  WHEN i.IDADE < 15 THEN '2 · 5 a 14'
  WHEN i.IDADE < 30 THEN '3 · 15 a 29'
  WHEN i.IDADE < 45 THEN '4 · 30 a 44'
  WHEN i.IDADE < 60 THEN '5 · 45 a 59'
  WHEN i.IDADE < 75 THEN '6 · 60 a 74'
  ELSE '7 · 75 ou mais'
END"""

CAMPOS: tuple[Campo, ...] = (
    # -- Tempo ------------------------------------------------------------- #
    Campo(
        id="ano",
        rotulo="Ano",
        grupo="Tempo",
        chave="year(i.DT_SAIDA)",
        tipo="numero",
        filtros=(FAIXA,),
        dominio=(
            "SELECT min(year(DT_SAIDA)), max(year(DT_SAIDA)) FROM internacoes "
            "WHERE DT_SAIDA IS NOT NULL"
        ),
        condicao="i.DT_SAIDA IS NOT NULL",
        distintos=17,
        ordinal=True,
        nota=(
            "Pela data de SAÍDA, que é o critério de competência da base. "
            "2007 tem só ago-dez: é um ano parcial e não compara com os outros."
        ),
    ),
    Campo(
        id="ano_mes",
        rotulo="Mês (série contínua)",
        grupo="Tempo",
        chave="strftime(i.DT_SAIDA, '%Y-%m')",
        tipo="categoria",
        condicao="i.DT_SAIDA IS NOT NULL",
        distintos=197,
        ordinal=True,
        nota="Série mensal de 2007-08 a 2023-12.",
    ),
    Campo(
        id="mes",
        rotulo="Mês do ano",
        grupo="Tempo",
        chave="month(i.DT_SAIDA)",
        tipo="numero",
        filtros=(MULTIPLA,),
        dominio=(
            "SELECT month(DT_SAIDA) AS v, month(DT_SAIDA) AS r, count(*) AS n "
            "FROM internacoes WHERE DT_SAIDA IS NOT NULL GROUP BY 1,2 ORDER BY 1"
        ),
        condicao="i.DT_SAIDA IS NOT NULL",
        distintos=12,
        ordinal=True,
        nota="1 a 12, somando todos os anos — serve para ver sazonalidade.",
    ),
    # -- Paciente ---------------------------------------------------------- #
    Campo(
        id="sexo",
        rotulo="Sexo",
        grupo="Paciente",
        chave="i.SEXO",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="sx.DESCRICAO",
        junta=J_SEXO,
        dominio=(
            "SELECT i.SEXO AS v, s.DESCRICAO AS r, count(*) AS n FROM internacoes i "
            "LEFT JOIN sexo s ON s.SEXO = i.SEXO GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=2,
        nota="No fato só existem 1 (masculino) e 3 (feminino); o código 2 nunca aparece.",
    ),
    Campo(
        id="faixa_etaria",
        rotulo="Faixa etária",
        grupo="Paciente",
        chave=FAIXA_ETARIA,
        tipo="categoria",
        filtros=(MULTIPLA,),
        dominio=(
            f"SELECT {FAIXA_ETARIA} AS v, {FAIXA_ETARIA} AS r, count(*) AS n "
            "FROM internacoes i WHERE i.IDADE BETWEEN 0 AND 120 GROUP BY 1,2 ORDER BY 1"
        ),
        condicao="i.IDADE BETWEEN 0 AND 120",
        distintos=8,
        ordinal=True,
        nota=(
            "Faixas fixas do modelo de pirâmide etária. O número na frente do rótulo "
            "existe para o eixo sair em ordem de idade, e não em ordem alfabética."
        ),
    ),
    Campo(
        id="idade",
        rotulo="Idade",
        grupo="Paciente",
        chave="i.IDADE",
        tipo="numero",
        filtros=(FAIXA,),
        dominio="SELECT min(IDADE), max(IDADE) FROM internacoes WHERE IDADE BETWEEN 0 AND 120",
        condicao="i.IDADE BETWEEN 0 AND 120",
        distintos=121,
        ordinal=True,
        nota="Anos completos. A base registra até 130; acima de 120 é lixo e fica de fora.",
    ),
    Campo(
        id="raca_cor",
        rotulo="Raça/cor",
        grupo="Paciente",
        chave="i.RACA_COR",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="rc.DESCRICAO",
        junta=J_RACA,
        dominio=(
            "SELECT i.RACA_COR AS v, r.DESCRICAO AS r, count(*) AS n FROM internacoes i "
            "LEFT JOIN raca_cor r ON r.RACA_COR = i.RACA_COR GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=6,
        nota=(
            "29,2% dos registros são 'Sem informação' — a segunda categoria mais "
            "frequente, à frente de 'Branca'. Não esconda essa fatia."
        ),
    ),
    # -- Clínico ----------------------------------------------------------- #
    Campo(
        id="morte",
        rotulo="Desfecho",
        grupo="Clínico",
        chave="i.MORTE",
        tipo="categoria",
        filtros=(ESCOLHA,),
        rotulo_sql="CASE WHEN i.MORTE THEN 'Óbito' ELSE 'Alta' END",
        dominio=(
            "SELECT MORTE AS v, CASE WHEN MORTE THEN 'Óbito' ELSE 'Alta' END AS r, "
            "count(*) AS n FROM internacoes GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=2,
        nota="Óbito durante a internação: 4,07% do total.",
    ),
    Campo(
        id="cid_capitulo",
        rotulo="Capítulo CID-10",
        grupo="Clínico",
        chave="cd.DS_CAPITULO",
        tipo="categoria",
        filtros=(MULTIPLA,),
        molde="i.DIAG_PRINC IN (SELECT CID FROM cid WHERE DS_CAPITULO {cmp})",
        rotulo_sql="cd.DS_CAPITULO",
        junta=J_CID,
        dominio=(
            "SELECT c.DS_CAPITULO AS v, c.DS_CAPITULO AS r, count(*) AS n FROM internacoes i "
            "JOIN cid c ON c.CID = i.DIAG_PRINC GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=22,
        nota="Os 22 capítulos da CID-10 — o corte mais grosso de causa.",
    ),
    Campo(
        id="diag_categoria",
        rotulo="Diagnóstico (categoria CID)",
        grupo="Clínico",
        chave="i.DIAG_PRINC",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="coalesce(cd.DS_CATEGORIA, i.DIAG_PRINC)",
        junta=J_CID,
        dominio=(
            "SELECT i.DIAG_PRINC AS v, coalesce(c.DS_CATEGORIA, i.DIAG_PRINC) AS r, "
            "count(*) AS n FROM internacoes i LEFT JOIN cid c ON c.CID = i.DIAG_PRINC "
            "GROUP BY 1,2 ORDER BY 3 DESC LIMIT 40"
        ),
        nota="Diagnóstico principal. Como filtro, as 40 categorias mais frequentes da base.",
    ),
    Campo(
        id="procedimento",
        rotulo="Procedimento",
        grupo="Clínico",
        chave="i.PROC_REA",
        tipo="categoria",
        rotulo_sql="coalesce(pc.NOME_PROC, i.PROC_REA)",
        junta=J_PROC,
        nota="1.928 procedimentos distintos aparecem no fato.",
    ),
    Campo(
        id="especialidade",
        rotulo="Especialidade do leito",
        grupo="Clínico",
        chave="i.ESPEC",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="ep.DESCRICAO",
        junta=J_ESPEC,
        dominio=(
            "SELECT i.ESPEC AS v, e.DESCRICAO AS r, count(*) AS n FROM internacoes i "
            "LEFT JOIN especialidade e ON e.ESPEC = i.ESPEC GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=16,
        nota="No fato só aparecem 1-14, 17 e 87. Os códigos de UTI não saem daqui.",
    ),
    Campo(
        id="uti",
        rotulo="Usou UTI",
        grupo="Clínico",
        chave="i.MARCA_UTI > 0",
        tipo="categoria",
        filtros=(ESCOLHA,),
        rotulo_sql="CASE WHEN i.MARCA_UTI > 0 THEN 'Com UTI' ELSE 'Sem UTI' END",
        dominio=(
            "SELECT MARCA_UTI > 0 AS v, "
            "CASE WHEN MARCA_UTI > 0 THEN 'Com UTI' ELSE 'Sem UTI' END AS r, "
            "count(*) AS n FROM internacoes GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=2,
        nota="6,3% das internações usaram UTI.",
    ),
    Campo(
        id="tipo_uti",
        rotulo="Tipo de UTI",
        grupo="Clínico",
        chave="i.MARCA_UTI",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="ut.DESCRICAO",
        junta=J_UTI,
        dominio=(
            "SELECT i.MARCA_UTI AS v, u.DESCRICAO AS r, count(*) AS n FROM internacoes i "
            "LEFT JOIN marca_uti u ON u.MARCA_UTI = i.MARCA_UTI WHERE i.MARCA_UTI > 0 "
            "GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        condicao="i.MARCA_UTI > 0",
        distintos=16,
        nota="Só quem usou UTI. Há dois códigos de UTI COVID-19 (51 e 52).",
    ),
    # -- Atendimento ------------------------------------------------------- #
    Campo(
        id="car_int",
        rotulo="Caráter da internação",
        grupo="Atendimento",
        chave="i.CAR_INT",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="ci.DESCRICAO",
        junta=J_CAR,
        dominio=(
            "SELECT i.CAR_INT AS v, c.DESCRICAO AS r, count(*) AS n FROM internacoes i "
            "LEFT JOIN car_int c ON c.CAR_INT = i.CAR_INT GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=6,
        nota="Eletivo, urgência e os tipos de acidente.",
    ),
    Campo(
        id="complexidade",
        rotulo="Complexidade",
        grupo="Atendimento",
        chave="i.COMPLEX",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="cx.DESCRICAO",
        junta=J_COMPLEX,
        dominio=(
            "SELECT i.COMPLEX AS v, c.DESCRICAO AS r, count(*) AS n FROM internacoes i "
            "LEFT JOIN complexidade c ON c.COMPLEX = i.COMPLEX GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=3,
        nota="No fato só aparecem 'Não informado', 'Média' e 'Alta complexidade'.",
    ),
    Campo(
        id="dias_perm",
        rotulo="Dias de permanência",
        grupo="Atendimento",
        chave="i.DIAS_PERM",
        tipo="numero",
        filtros=(FAIXA,),
        dominio="SELECT min(DIAS_PERM), max(DIAS_PERM) FROM internacoes",
        ordinal=True,
        nota=(
            "Média de 5,06 dias. O máximo é 5.476, mas 99,99% das internações "
            "duram até um ano — a ponta do controle cobre um punhado de casos."
        ),
    ),
    Campo(
        id="val_tot",
        rotulo="Valor da AIH (R$)",
        grupo="Atendimento",
        chave="i.VAL_TOT",
        tipo="numero",
        filtros=(FAIXA,),
        dominio="SELECT 0, CAST(ceil(max(VAL_TOT)) AS BIGINT) FROM internacoes",
        ordinal=True,
        nota=(
            "Valores NOMINAIS, sem correção inflacionária. Média R$ 1.472,30 e "
            "máximo R$ 537.768 — 98,97% das AIH ficam abaixo de R$ 20 mil."
        ),
    ),
    # -- Geografia --------------------------------------------------------- #
    Campo(
        id="uf",
        rotulo="UF de residência",
        grupo="Geografia",
        chave="mu.SG_UF",
        tipo="categoria",
        filtros=(MULTIPLA,),
        molde="i.MUNIC_RES IN (SELECT CO_MUNICIPIO_6D FROM municipios WHERE SG_UF {cmp})",
        rotulo_sql="mu.SG_UF",
        junta=J_MUN,
        dominio=(
            "SELECT m.SG_UF AS v, m.SG_UF AS r, count(*) AS n FROM internacoes i "
            "JOIN municipios m ON m.CO_MUNICIPIO_6D = i.MUNIC_RES GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=27,
        nota="RESIDÊNCIA do paciente, não onde fica o hospital — a base não tem o hospital.",
    ),
    Campo(
        id="regiao",
        rotulo="Região",
        grupo="Geografia",
        chave=REGIAO.format(uf="mu.SG_UF"),
        tipo="categoria",
        filtros=(MULTIPLA,),
        molde=(
            "i.MUNIC_RES IN (SELECT CO_MUNICIPIO_6D FROM municipios WHERE "
            + REGIAO.format(uf="SG_UF")
            + " {cmp})"
        ),
        rotulo_sql=REGIAO.format(uf="mu.SG_UF"),
        junta=J_MUN,
        dominio=(
            "SELECT "
            + REGIAO.format(uf="m.SG_UF")
            + " AS v, "
            + REGIAO.format(uf="m.SG_UF")
            + " AS r, count(*) AS n FROM internacoes i "
            "JOIN municipios m ON m.CO_MUNICIPIO_6D = i.MUNIC_RES GROUP BY 1,2 ORDER BY 3 DESC"
        ),
        distintos=5,
        nota="Derivada da UF de residência: a base não traz região como coluna.",
    ),
    Campo(
        id="municipio",
        rotulo="Município de residência",
        grupo="Geografia",
        chave="i.MUNIC_RES",
        tipo="categoria",
        filtros=(MULTIPLA,),
        rotulo_sql="coalesce(mu.NO_MUNICIPIO, i.MUNIC_RES::VARCHAR)",
        junta=J_MUN,
        dominio=(
            "SELECT i.MUNIC_RES AS v, m.NO_MUNICIPIO AS r, count(*) AS n FROM internacoes i "
            "JOIN municipios m ON m.CO_MUNICIPIO_6D = i.MUNIC_RES GROUP BY 1,2 "
            "ORDER BY 3 DESC LIMIT 40"
        ),
        nota="5.590 municípios. Como filtro, os 40 com mais internações.",
    ),
)

MEDIDAS: tuple[Medida, ...] = (
    Medida(id="internacoes", rotulo="Internações", expr="COUNT(*)", alias="internacoes"),
    Medida(
        id="obitos",
        rotulo="Óbitos",
        expr="COUNT(*) FILTER (WHERE i.MORTE)",
        alias="obitos",
        nota="Óbitos ocorridos durante a internação.",
    ),
    Medida(
        id="taxa_obito",
        rotulo="Taxa de mortalidade (%)",
        expr="ROUND(100.0 * COUNT(*) FILTER (WHERE i.MORTE) / COUNT(*), 2)",
        alias="taxa_obito_pct",
        unidade="%",
        minimo_casos=1000,
        nota=(
            "Grupos com menos de mil internações ficam de fora: sem piso, o topo do "
            "ranking é sempre um grupo minúsculo com 100%."
        ),
    ),
    Medida(
        id="com_uti",
        rotulo="Internações com UTI",
        expr="COUNT(*) FILTER (WHERE i.MARCA_UTI > 0)",
        alias="com_uti",
    ),
    Medida(
        id="taxa_uti",
        rotulo="Uso de UTI (%)",
        expr="ROUND(100.0 * COUNT(*) FILTER (WHERE i.MARCA_UTI > 0) / COUNT(*), 2)",
        alias="uso_uti_pct",
        unidade="%",
        minimo_casos=1000,
    ),
    Medida(
        id="valor_total",
        rotulo="Valor total (R$)",
        expr="ROUND(SUM(i.VAL_TOT), 2)",
        alias="valor_total",
        unidade="R$",
        nota="Valores nominais, sem deflação.",
    ),
    Medida(
        id="valor_medio",
        rotulo="Valor médio da AIH (R$)",
        expr="ROUND(AVG(i.VAL_TOT), 2)",
        alias="valor_medio",
        unidade="R$",
        nota="Valores nominais, sem deflação.",
    ),
    Medida(
        id="dias_medios",
        rotulo="Permanência média (dias)",
        expr="ROUND(AVG(i.DIAS_PERM), 2)",
        alias="dias_medios",
    ),
    Medida(
        id="dias_totais",
        rotulo="Dias de internação (total)",
        expr="SUM(i.DIAS_PERM)",
        alias="dias_totais",
    ),
    Medida(
        id="idade_media",
        rotulo="Idade média",
        expr="ROUND(AVG(i.IDADE) FILTER (WHERE i.IDADE BETWEEN 0 AND 120), 1)",
        alias="idade_media",
    ),
)

# As formas de gráfico do menu, com a exigência de cada uma. A tela desabilita a
# que não bate: pizza com trinta fatias e mapa de calor sem série são gráficos
# ilegíveis, e isso não é questão de gosto.
FORMAS: tuple[dict, ...] = (
    {"id": "barra", "label": "Barras verticais", "needsSeries": False, "maxCategories": 0},
    {"id": "barra_horizontal", "label": "Barras horizontais (ranking)", "needsSeries": False, "maxCategories": 0},
    {"id": "linha", "label": "Linha", "needsSeries": False, "maxCategories": 0},
    {"id": "pizza", "label": "Pizza", "needsSeries": False, "maxCategories": 8},
    {"id": "empilhada_100", "label": "Barras 100% empilhadas", "needsSeries": True, "maxCategories": 0},
    {"id": "heatmap", "label": "Mapa de calor", "needsSeries": True, "maxCategories": 0},
)

ORDENS: tuple[dict, ...] = (
    {"id": "valor_desc", "label": "Maior valor primeiro"},
    {"id": "valor_asc", "label": "Menor valor primeiro"},
    {"id": "categoria_asc", "label": "Ordem da categoria"},
    {"id": "categoria_desc", "label": "Categoria invertida"},
)

_POR_ID = {c.id: c for c in CAMPOS}
_MEDIDA_POR_ID = {m.id: m for m in MEDIDAS}
_FORMA_POR_ID = {f["id"]: f for f in FORMAS}


def campo(id_: str) -> Campo | None:
    return _POR_ID.get(id_)


def medida(id_: str) -> Medida | None:
    return _MEDIDA_POR_ID.get(id_)


def forma(id_: str) -> dict | None:
    return _FORMA_POR_ID.get(id_)


def para_json() -> dict:
    """O catálogo como a tela o consome."""
    return {
        "fields": [c.para_json() for c in CAMPOS],
        "measures": [m.para_json() for m in MEDIDAS],
        "forms": list(FORMAS),
        "orders": list(ORDENS),
        "filterKinds": [
            {"id": FAIXA, "label": "Faixa (de … até)"},
            {"id": MULTIPLA, "label": "Marcar vários"},
            {"id": ESCOLHA, "label": "Escolher um"},
        ],
    }
