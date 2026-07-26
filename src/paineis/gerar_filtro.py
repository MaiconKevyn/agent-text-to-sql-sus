"""Cria um filtro a partir de um pedido em linguagem natural.

O modelo declara a coluna, a forma do controle e o fragmento SQL. O código lê o
DOMÍNIO no banco e confere que o fragmento executa. Nenhuma opção é inventada:
um filtro de sexo com "Masculino/Feminino" escrito à mão erraria, porque nesta
base os valores são 1 e 3 — e podem existir 0 e 9 que ninguém previu.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..config import settings
from ..db import Database, UnsafeQueryError, validate_sql
from ..llm import complete
from ..schema_context import build_schema_prompt
from .filtros import Filtro, Opcao

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["possivel", "rotulo", "tipo", "fragmento", "dominio_sql", "nota", "recusa"],
    "properties": {
        "possivel": {"type": "boolean", "description": "false se a base não tem essa coluna."},
        "rotulo": {"type": "string", "description": "Nome do filtro na tela. Curto: 'Sexo', 'Idade'."},
        "tipo": {
            "type": "string",
            "enum": ["faixa", "escolha", "multipla"],
            "description": (
                "'faixa' para número contínuo (idade, valor). 'multipla' quando faz "
                "sentido marcar mais de um (sexo, caráter da internação). 'escolha' "
                "quando só um por vez."
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
                "Para 'faixa': SELECT min(col), max(col) FROM internacoes WHERE <sanidade>. "
                "Para escolha/múltipla: SELECT col AS valor, count(*) AS n FROM internacoes "
                "GROUP BY 1 ORDER BY 2 DESC LIMIT 40. Sem `?`."
            ),
        },
        "nota": {
            "type": "string",
            "description": (
                "Uma frase sobre o que os valores significam nesta base, quando não for "
                "óbvio — ex.: 'SEXO: 1 masculino, 3 feminino'. Vira dica na tela."
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

## RECUSE QUANDO NÃO DER

Filtro por hospital, por nome de médico, por raça se a coluna não existir: \
possivel=false com o motivo. Um filtro que não filtra é pior que a ausência \
dele, porque a pessoa acredita que aplicou."""


@dataclass
class Resultado:
    filtro: Filtro | None = None
    recusa: str = ""


def gerar(pedido: str, db: Database) -> Resultado:
    """Declara, lê o domínio no banco, e prova que o fragmento executa."""
    bruto = complete(
        model=settings.sql_model,
        system=SISTEMA.format(schema=build_schema_prompt()),
        messages=[{"role": "user", "content": f"Filtro pedido: {pedido}"}],
        schema=ESQUEMA,
        schema_name="filtro",
        reasoning_effort="medium",
    )
    assert isinstance(bruto, dict)
    if not bruto.get("possivel"):
        return Resultado(recusa=str(bruto.get("recusa") or "A base não tem esse recorte.")[:400])

    tipo = bruto.get("tipo") if bruto.get("tipo") in ("faixa", "escolha", "multipla") else "escolha"
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

    if tipo == "faixa":
        try:
            filtro.minimo, filtro.maximo = int(dom.rows[0][0]), int(dom.rows[0][1])
        except (TypeError, ValueError, IndexError):
            return Resultado(recusa="A consulta de domínio de faixa não devolveu dois números.")
        filtro.selecao = [filtro.minimo, filtro.maximo]
    else:
        filtro.opcoes = [
            Opcao(valor=r[0], rotulo=str(r[0]), n=int(r[1]) if len(r) > 1 and r[1] is not None else 0)
            for r in dom.rows
            if r[0] is not None
        ][:40]
        if not filtro.opcoes:
            return Resultado(recusa="O domínio veio só com nulos.")
        # Nasce com tudo marcado, que é o mesmo que não filtrar. Um filtro que
        # nasce recortando mudaria o painel inteiro sem ninguém pedir.
        filtro.selecao = [o.valor for o in filtro.opcoes]

    # A prova: o fragmento executa com valores reais? Ele nasce inativo, então
    # forço uma seleção parcial só para o teste.
    teste = Filtro(**{**filtro.__dict__})
    if tipo == "faixa":
        teste.selecao = [filtro.minimo, filtro.maximo]
    else:
        teste.selecao = [filtro.opcoes[0].valor]
    try:
        db.run(
            f"SELECT COUNT(*) FROM internacoes i WHERE {fragmento}",
            params=teste.valores(),
            max_rows=1,
        )
    except Exception as exc:  # noqa: BLE001
        return Resultado(recusa=f"O fragmento não executa: {str(exc)[:200]}")

    return Resultado(filtro=filtro)
