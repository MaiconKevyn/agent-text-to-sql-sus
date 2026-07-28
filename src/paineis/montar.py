"""Monta filtro e widget a partir de escolhas de menu, sem passar por modelo.

O caminho em linguagem natural e este aqui trocam de lugar quem declara: lá o
modelo declara e o código confere; aqui QUEM DECLARA É A PESSOA, escolhendo de
uma lista, e o código monta. O que não muda é a última etapa — o SQL é montado
aqui dentro, a partir do catálogo, e passa pelas mesmas provas de execução. Em
nenhum dos dois caminhos o cliente manda SQL.

Isso importa mais do que parece. A tela envia `{"measure":"obitos",
"field":"uf"}`; se ela pudesse enviar a consulta, o menu manual seria um console
de SQL com aparência de menu, e toda a garantia do validador viraria enfeite.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..db import Database, UnsafeQueryError, json_safe, validate_sql
from . import catalogo as cat
from .filtros import TOKEN, Filtro, Opcao
from .models import Widget

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Quantas categorias um gráfico manual traz por padrão, e o teto. Acima de 60
# barras ninguém lê o eixo — e a consulta ainda varre 144 milhões de linhas
# para produzir o que não se lê.
LIMITE_PADRAO, LIMITE_MAX = 15, 60


@dataclass
class ResultadoFiltro:
    filtro: Filtro | None = None
    recusa: str = ""


@dataclass
class ResultadoWidget:
    widget: Widget | None = None
    recusa: str = ""


# --------------------------------------------------------------------------- #
# Filtro
# --------------------------------------------------------------------------- #
def filtro(campo_id: str, tipo: str, db: Database, rotulo: str = "") -> ResultadoFiltro:
    """Cria um filtro a partir de um campo do catálogo e um tipo de controle."""
    c = cat.campo(campo_id)
    if c is None:
        return ResultadoFiltro(recusa=f"Campo desconhecido: {campo_id}.")
    if tipo not in c.filtros:
        oferece = ", ".join(c.filtros) or "nenhum"
        return ResultadoFiltro(
            recusa=f"{c.rotulo} não aceita o controle '{tipo}'. Oferece: {oferece}."
        )

    try:
        dominio = validate_sql(c.dominio)
        dom = db.run(dominio, max_rows=60)
    except UnsafeQueryError as exc:
        return ResultadoFiltro(recusa=f"A consulta de domínio foi recusada: {exc}")
    except Exception as exc:  # noqa: BLE001
        return ResultadoFiltro(recusa=f"A consulta de domínio não executou: {str(exc)[:200]}")
    if not dom.rows:
        return ResultadoFiltro(recusa="A consulta de domínio não devolveu nada.")

    f = Filtro(
        rotulo=(rotulo.strip() or c.rotulo)[:40],
        tipo=tipo,
        fragmento=c.fragmento(tipo),
        nota=c.nota,
    )

    if tipo in cat.INTERVALOS:
        f.minimo, f.maximo, erro = limites(dom.rows, tipo)
        if erro:
            return ResultadoFiltro(recusa=erro)
        f.selecao = [f.minimo, f.maximo]
    else:
        # O domínio traz (valor, rótulo, contagem): o filtro COMPARA o código e
        # MOSTRA a descrição. Sem as duas colunas, um filtro de sexo mostraria
        # "1" e "3" — que é o que a versão anterior fazia.
        f.opcoes = opcoes_de(dom.rows)[:40]
        if not f.opcoes:
            return ResultadoFiltro(recusa="O domínio veio só com nulos.")
        # Nasce com tudo marcado, que é o mesmo que não filtrar.
        f.selecao = [o.valor for o in f.opcoes]

    erro = provar(f, db)
    return ResultadoFiltro(recusa=erro) if erro else ResultadoFiltro(filtro=f)


def opcoes_de(linhas: list) -> list[Opcao]:
    """Lê o domínio de um filtro, com ou sem coluna de rótulo.

    Duas formas são aceitas porque há dois produtores: o menu manual sempre
    manda (valor, rótulo, contagem), e o modelo às vezes manda só (valor,
    contagem). Cair de volta no código como rótulo é feio, mas é honesto —
    melhor "3" do que um rótulo inventado.
    """
    saida: list[Opcao] = []
    for r in linhas:
        if not r or r[0] is None:
            continue
        if len(r) >= 3:
            saida.append(Opcao(valor=r[0], rotulo=_texto(r[1], r[0]), n=_inteiro(r[2])))
        elif len(r) == 2:
            # Duas colunas: a segunda é contagem se for número, senão rótulo.
            if isinstance(r[1], (int, float)) and not isinstance(r[1], bool):
                saida.append(Opcao(valor=r[0], rotulo=_texto(r[0], r[0]), n=_inteiro(r[1])))
            else:
                saida.append(Opcao(valor=r[0], rotulo=_texto(r[1], r[0]), n=0))
        else:
            saida.append(Opcao(valor=r[0], rotulo=_texto(r[0], r[0]), n=0))
    return saida


def limites(linhas: list, tipo: str) -> tuple:
    """Lê os dois limites de um controle de intervalo. Devolve (min, max, erro).

    Aceita as duas formas porque a consulta de domínio é a mesma —
    `SELECT min(col), max(col)` — e o que muda é o TIPO da coluna. A versão
    anterior chamava `int()` nos dois casos, e um filtro de data perfeitamente
    declarado (`i.DT_SAIDA BETWEEN ? AND ?`) morria em
    `int(datetime.date(2007, 8, 1))` acusando o modelo de não ter devolvido
    números — quando quem não sabia ler datas era este código.
    """
    try:
        a, b = linhas[0][0], linhas[0][1]
    except (IndexError, TypeError):
        return None, None, "A consulta de domínio não devolveu dois limites."
    if a is None or b is None:
        return None, None, "A consulta de domínio devolveu limite nulo."

    if tipo == cat.DATA:
        # ISO, e só a data: o painel guarda o filtro em JSON, e um `date` do
        # Python não atravessa. O DuckDB compara o texto com a coluna DATE sem
        # precisar de cast — conferido contra o literal `DATE '…'`.
        ini, fim = str(json_safe(a))[:10], str(json_safe(b))[:10]
        if not (_ISO.match(ini) and _ISO.match(fim)):
            return None, None, f"Os limites não são datas: {ini!r} e {fim!r}."
        return ini, fim, ""

    try:
        return int(a), int(b), ""
    except (TypeError, ValueError):
        return None, None, (
            f"O domínio da faixa não devolveu dois números ({type(a).__name__}). "
            "Para uma coluna de data, o controle é 'data', não 'faixa'."
        )


def provar(f: Filtro, db: Database) -> str:
    """Executa o fragmento com valores reais. Devolve o erro, ou string vazia.

    Um filtro nasce inativo — tudo marcado —, então a prova força uma seleção
    parcial. Sem isso, um fragmento quebrado só apareceria quando alguém
    clicasse, e aí o painel inteiro erra de uma vez.
    """
    teste = Filtro(**{**f.__dict__})
    teste.selecao = (
        [f.minimo, f.maximo] if f.tipo in cat.INTERVALOS else [f.opcoes[0].valor]
    )
    try:
        db.run(
            f"SELECT COUNT(*) FROM internacoes i WHERE {f.fragmento}",
            params=teste.valores(),
            max_rows=1,
        )
    except Exception as exc:  # noqa: BLE001
        return f"O fragmento não executa: {str(exc)[:200]}"
    return ""


def _texto(v, alternativa) -> str:
    return str(v) if v is not None else str(alternativa)


def _inteiro(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


# --------------------------------------------------------------------------- #
# Widget
# --------------------------------------------------------------------------- #
@dataclass
class Pedido:
    """O que a tela envia. Nada aqui é SQL — são ids do catálogo e números."""

    medida: str
    campo: str = ""  # vazio = indicador (um número só)
    serie: str = ""
    forma: str = "barra"
    ordem: str = "valor_desc"
    limite: int = LIMITE_PADRAO
    titulo: str = ""
    aparencia: dict | None = None


def widget(p: Pedido, db: Database) -> ResultadoWidget:
    """Monta o SQL a partir do catálogo e prova que ele executa."""
    m = cat.medida(p.medida)
    if m is None:
        return ResultadoWidget(recusa=f"Medida desconhecida: {p.medida}.")

    dim = cat.campo(p.campo) if p.campo else None
    if p.campo and dim is None:
        return ResultadoWidget(recusa=f"Campo desconhecido: {p.campo}.")
    if dim is not None and not dim.agrupavel:
        return ResultadoWidget(
            recusa=(
                f"{dim.rotulo} só serve para recortar, não para virar eixo: o gráfico "
                "sairia com uma barra por dia. Para ver ao longo do tempo, agrupe por "
                "'Ano' ou 'Mês (série contínua)'."
            )
        )

    serie = cat.campo(p.serie) if p.serie else None
    if p.serie and serie is None:
        return ResultadoWidget(recusa=f"Campo de série desconhecido: {p.serie}.")
    if serie is not None and dim is None:
        return ResultadoWidget(recusa="Uma série precisa de um eixo de categoria.")
    if serie is not None and dim is not None and serie.id == dim.id:
        return ResultadoWidget(recusa="A série tem de ser um campo diferente do eixo.")
    if serie is not None and not serie.serve_serie:
        return ResultadoWidget(
            recusa=(
                f"{serie.rotulo} tem valores demais para virar série — a legenda "
                f"ficaria maior que o gráfico. Até {cat.TETO_SERIE} categorias."
            )
        )

    forma = cat.forma(p.forma) or cat.forma("barra")
    assert forma is not None
    if dim is not None and forma["needsSeries"] and serie is None:
        return ResultadoWidget(recusa=f"{forma['label']} exige uma série além do eixo.")

    limite = max(3, min(LIMITE_MAX, int(p.limite or LIMITE_PADRAO)))
    sql = _sql(m, dim, serie, p.ordem, limite)

    try:
        sql = validate_sql(sql)
    except UnsafeQueryError as exc:
        return ResultadoWidget(recusa=f"SQL recusado pelo validador: {exc}")

    # As mesmas duas provas do caminho em linguagem natural: sem filtro nenhum,
    # e com um filtro de mentira no lugar do token. A segunda pega o caso em que
    # o token cairia fora de um WHERE utilizável.
    try:
        res = db.run(sql.replace(TOKEN, ""), max_rows=5)
    except Exception as exc:  # noqa: BLE001
        return ResultadoWidget(recusa=f"A consulta não executou: {str(exc)[:220]}")
    try:
        db.run(sql.replace(TOKEN, " AND (1=1)"), max_rows=1)
    except Exception as exc:  # noqa: BLE001
        return ResultadoWidget(recusa=f"O token não ficou num WHERE utilizável: {str(exc)[:200]}")
    if not res.rows:
        return ResultadoWidget(
            recusa="A consulta não devolve nenhuma linha sem filtro algum. Reveja as escolhas."
        )

    formato = "indicador" if dim is None else "grafico"
    titulo = p.titulo.strip() or (f"{m.rotulo} por {dim.rotulo}" if dim else m.rotulo)

    chart = None
    if dim is not None:
        chart = {
            "kind": forma["id"],
            "x": dim.id,
            "y": m.alias,
            "series": serie.id if serie else "",
            "title": titulo,
            "reason": "",
            **aparencia(p.aparencia),
        }

    return ResultadoWidget(
        widget=Widget(
            titulo=titulo[:120],
            # A pergunta fica registrada em português: é ela que aparece no
            # detalhe do widget e o que o botão "recriar" usa.
            pergunta=_frase(m, dim, serie, limite),
            sql=sql,
            chart=chart,
            formato=formato,
            suposicoes=[n for n in (m.nota, dim.nota if dim else "", serie.nota if serie else "") if n],
            largura=4 if formato == "indicador" else 6,
            altura=5 if formato == "indicador" else 10,
        )
    )


APARENCIA_PADRAO = {
    "colors": None,
    "showLabels": False,
    "showLegend": True,
    "smooth": True,
    "area": False,
    "stack": False,
}


def aparencia(bruta: dict | None) -> dict:
    """Só as chaves conhecidas, com o tipo certo. O resto é descartado."""
    d = dict(APARENCIA_PADRAO)
    if not isinstance(bruta, dict):
        return d
    cores = bruta.get("colors")
    if isinstance(cores, list):
        # Hex de 3 ou 6 dígitos, e no máximo doze: é o que uma legenda comporta.
        limpas = [
            c
            for c in cores
            if isinstance(c, str) and len(c) in (4, 7) and c.startswith("#")
        ][:12]
        d["colors"] = limpas or None
    for chave in ("showLabels", "showLegend", "smooth", "area", "stack"):
        if isinstance(bruta.get(chave), bool):
            d[chave] = bruta[chave]
    return d


def _sql(m: cat.Medida, dim: cat.Campo | None, serie: cat.Campo | None, ordem: str, limite: int) -> str:
    """A consulta viva: com o token no WHERE e nenhum resultado embutido."""
    if dim is None:
        return (
            f"SELECT {m.expr} AS {m.alias}\n"
            f"FROM internacoes i\n"
            f"WHERE 1=1 {TOKEN}"
        )

    # LEFT JOIN e não INNER: um código órfão tem de virar NULL, não sumir da
    # contagem. `cid` tem 777 órfãos no fato e `procedimentos` tem 370 — com
    # INNER JOIN o total do gráfico não bate com o total do painel.
    juntas = [j for j in dict.fromkeys([dim.junta, serie.junta if serie else ""]) if j]
    condicoes = [c for c in dict.fromkeys([dim.condicao, serie.condicao if serie else ""]) if c]

    colunas = [f"{dim.expr_rotulo} AS {dim.id}"]
    if serie is not None:
        colunas.append(f"{serie.expr_rotulo} AS {serie.id}")
    colunas.append(f"{m.expr} AS {m.alias}")

    grupos = ", ".join(str(n + 1) for n in range(len(colunas) - 1))
    onde = " AND ".join(condicoes) if condicoes else "1=1"

    partes = [
        "SELECT " + ",\n       ".join(colunas),
        "FROM internacoes i",
        *juntas,
        f"WHERE {onde} {TOKEN}",
        f"GROUP BY {grupos}",
    ]
    # O piso de casos vale para taxas. Sem ele, o topo de um ranking de
    # mortalidade é sempre um grupo de três internações com 100%.
    if m.minimo_casos:
        partes.append(f"HAVING COUNT(*) >= {m.minimo_casos}")
    partes.append(f"ORDER BY {_ordenacao(m, dim, serie, ordem)}")
    # Com série, o limite conta LINHAS e não categorias — daí a multiplicação
    # pelo número de séries, senão o gráfico perderia categorias pela metade.
    partes.append(f"LIMIT {limite * max(1, serie.distintos) if serie else limite}")
    return "\n".join(partes)


def _ordenacao(m: cat.Medida, dim: cat.Campo, serie: cat.Campo | None, ordem: str) -> str:
    # Com série, ordenar pelo valor embaralharia as categorias entre as séries:
    # o eixo sairia com a mesma UF em dois lugares. Ordena pela categoria.
    if serie is not None:
        return "1, 2"
    if ordem == "categoria_asc" or (dim.ordinal and ordem.startswith("valor")):
        # Um eixo de tempo ordenado por valor não é uma série temporal: são
        # anos fora de ordem lado a lado, e a linha entre eles não significa
        # nada. A ordem cronológica ganha do que foi pedido.
        return "1"
    if ordem == "categoria_desc":
        return "1 DESC"
    if ordem == "valor_asc":
        return f"{m.alias} ASC"
    return f"{m.alias} DESC"


def _frase(m: cat.Medida, dim: cat.Campo | None, serie: cat.Campo | None, limite: int) -> str:
    if dim is None:
        return f"{m.rotulo} (montado no menu)"
    frase = f"{m.rotulo} por {dim.rotulo}"
    if serie is not None:
        frase += f", separado por {serie.rotulo}"
    return f"{frase} — {limite} categorias (montado no menu)"
