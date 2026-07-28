"""Cria um filtro a partir de um pedido em linguagem natural.

O modelo declara a coluna, a forma do controle e o fragmento SQL. O código lê o
DOMÍNIO no banco e confere que o fragmento executa. Nenhuma opção é inventada:
um filtro de sexo com "Masculino/Feminino" escrito à mão erraria, porque nesta
base os valores são 1 e 3 — e podem existir 0 e 9 que ninguém previu.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..config import settings
from ..db import Database, UnsafeQueryError, validate_sql
from ..llm import complete
from ..schema_context import build_schema_prompt
from . import montar
from .filtros import INTERVALOS, TIPOS, Filtro

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["possivel", "rotulo", "tipo", "fragmento", "dominio_sql", "nota", "apenas", "recusa"],
    "properties": {
        "possivel": {"type": "boolean", "description": "false se a base não tem essa coluna."},
        "rotulo": {"type": "string", "description": "Nome do filtro na tela. Curto: 'Sexo', 'Idade'."},
        "tipo": {
            "type": "string",
            "enum": ["faixa", "data", "escolha", "multipla"],
            "description": (
                "'data' para coluna de DATA (DT_SAIDA, DT_INTER) — período de uma data "
                "a outra. 'faixa' para número contínuo (idade, valor, ano). 'multipla' "
                "quando faz sentido marcar mais de um (sexo, caráter da internação). "
                "'escolha' quando só um por vez."
            ),
        },
        "fragmento": {
            "type": "string",
            "description": (
                "Expressão booleana AUTOSSUFICIENTE com `?`, usando o alias `i` do fato. "
                "faixa: 'i.IDADE BETWEEN ? AND ?'. multipla: 'i.SEXO = ANY(?)'. "
                "escolha: 'i.CAR_INT = ?'. Se precisar de outra tabela, use SUBCONSULTA e "
                "não join: 'i.MUNIC_RES IN (SELECT CO_MUNICIPIO_6D FROM municipios WHERE SG_UF = ?)'. "
                "O fragmento tem de valer para qualquer widget, inclusive os que não "
                "fazem aquele join."
            ),
        },
        "dominio_sql": {
            "type": "string",
            "description": (
                "SELECT que devolve as opções ou os limites, e nada mais. "
                "Para 'faixa' e 'data': SELECT min(col), max(col) FROM internacoes "
                "WHERE <sanidade>. "
                "Para escolha/múltipla, TRÊS colunas nesta ordem — código, rótulo "
                "legível e contagem: SELECT i.SEXO, s.DESCRICAO, count(*) FROM "
                "internacoes i LEFT JOIN sexo s ON s.SEXO = i.SEXO GROUP BY 1,2 "
                "ORDER BY 3 DESC LIMIT 40. O rótulo é o que aparece no botão; sem "
                "ele a pessoa vê '1' e '3' e não sabe qual é qual. Se a coluna não "
                "tiver dimensão, repita o próprio valor como rótulo. Sem `?`."
            ),
        },
        "nota": {
            "type": "string",
            "description": (
                "Uma frase sobre o que os valores significam nesta base, quando não for "
                "óbvio — ex.: 'SEXO: 1 masculino, 3 feminino'. Vira dica na tela."
            ),
        },
        "apenas": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Os ids dos widgets em que este filtro deve valer, copiados do catálogo, "
                "e SÓ quando o pedido restringe explicitamente ('aplique só no gráfico "
                "de óbitos'). Lista vazia — o normal — significa que vale para todos."
            ),
        },
        "recusa": {"type": "string", "description": "Se possivel=false, o que falta."},
    },
}

SISTEMA = """Você declara um FILTRO de painel sobre internações do SUS. O filtro \
vale para TODOS os gráficos do painel ao mesmo tempo.

{schema}

## O FRAGMENTO TEM DE SE BASTAR

Ele é colado dentro do WHERE de consultas que você não escreveu. Só pode \
referenciar `i.<coluna>` do fato e subconsultas. Nada de depender de um JOIN — \
metade dos widgets não terá aquele join, e o filtro quebraria neles.

## AS OPÇÕES VÊM DO BANCO, NÃO DE VOCÊ

`dominio_sql` é executado, e o que ele devolver é o que aparece na tela. Não \
escreva rótulos: se SEXO tem 1 e 3, é isso que a pessoa vai ver — e a `nota` é \
onde você explica o que significam.

Para 'faixa', ponha na consulta o recorte de sanidade que a base exige: idade \
tem registro de 0 a 120 que é plausível, e valores fora disso são lixo.

## POR PADRÃO O FILTRO VALE PARA TODOS OS GRÁFICOS

Só devolva `apenas` preenchido quando o pedido restringir de forma explícita — \
"esse filtro só no gráfico de óbitos", "aplique apenas no total". Um filtro que \
nasce restrito sem ninguém pedir surpreende: a pessoa cria o recorte, vê metade \
da tela parada, e não tem como saber por quê.

## RECUSE QUANDO NÃO DER

Filtro por hospital, por nome de médico, por raça se a coluna não existir: \
possivel=false com o motivo. Um filtro que não filtra é pior que a ausência \
dele, porque a pessoa acredita que aplicou."""


@dataclass
class Resultado:
    filtro: Filtro | None = None
    recusa: str = ""
    apenas: list[str] = field(default_factory=list)


@dataclass
class Restricao:
    """Widgets em que o filtro deve valer. Vazio = todos."""

    apenas: list[str] = field(default_factory=list)


def gerar(pedido: str, db: Database, catalogo: str = "") -> Resultado:
    """Declara, lê o domínio no banco, e prova que o fragmento executa."""
    bruto = complete(
        model=settings.sql_model,
        system=SISTEMA.format(schema=build_schema_prompt()),
        messages=[
            {
                "role": "user",
                "content": (
                    (f"## WIDGETS DO PAINEL\n{catalogo}\n\n" if catalogo else "")
                    + f"Filtro pedido: {pedido}"
                ),
            }
        ],
        schema=ESQUEMA,
        schema_name="filtro",
        reasoning_effort="medium",
    )
    assert isinstance(bruto, dict)
    if not bruto.get("possivel"):
        return Resultado(recusa=str(bruto.get("recusa") or "A base não tem esse recorte.")[:400])

    tipo = bruto.get("tipo") if bruto.get("tipo") in TIPOS else "escolha"
    fragmento = str(bruto.get("fragmento") or "").strip()
    dominio_sql = str(bruto.get("dominio_sql") or "").strip()
    if not fragmento or not dominio_sql:
        return Resultado(recusa="O modelo não declarou o fragmento ou o domínio.")

    try:
        dominio_sql = validate_sql(dominio_sql)
    except UnsafeQueryError as exc:
        return Resultado(recusa=f"A consulta de domínio foi recusada: {exc}")

    try:
        dom = db.run(dominio_sql, max_rows=60)
    except Exception as exc:  # noqa: BLE001
        return Resultado(recusa=f"A consulta de domínio não executou: {str(exc)[:200]}")
    if not dom.rows:
        return Resultado(recusa="A consulta de domínio não devolveu nada.")

    filtro = Filtro(
        rotulo=str(bruto.get("rotulo") or pedido)[:40],
        tipo=tipo,
        fragmento=fragmento,
        nota=str(bruto.get("nota") or "")[:200],
    )

    if tipo in INTERVALOS:
        # O mesmo leitor do menu manual, e por isso um filtro de data declarado
        # aqui funciona igual ao escolhido lá.
        filtro.minimo, filtro.maximo, erro = montar.limites(dom.rows, tipo)
        if erro:
            return Resultado(recusa=erro)
        filtro.selecao = [filtro.minimo, filtro.maximo]
    else:
        # O mesmo leitor do menu manual: ele aceita o domínio com rótulo (três
        # colunas) e sem (duas), porque há dois produtores e só um deles é este.
        filtro.opcoes = montar.opcoes_de(dom.rows)[:40]
        if not filtro.opcoes:
            return Resultado(recusa="O domínio veio só com nulos.")
        # Nasce com tudo marcado, que é o mesmo que não filtrar. Um filtro que
        # nasce recortando mudaria o painel inteiro sem ninguém pedir.
        filtro.selecao = [o.valor for o in filtro.opcoes]

    erro = montar.provar(filtro, db)
    if erro:
        return Resultado(recusa=erro)

    return Resultado(filtro=filtro, apenas=[str(x) for x in (bruto.get("apenas") or [])])
