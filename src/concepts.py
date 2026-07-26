"""Resolve um termo clínico nos códigos que ele significa NESTA base.

O agente erra a definição operacional com mais frequência do que erra SQL, e o
erro de definição é o mais caro porque o número sai plausível:

  - "covid" virou U07, que tem ZERO linhas — a COVID está em B342 (905.001
    internações só em 2021);
  - "câncer" virou C00-C97 MAIS D00-D48, incluindo neoplasia benigna, e o
    relatório rotulou o conjunto só como "câncer";
  - "parto" virou UM procedimento (0310010039) quando existem sete, deixando
    1.190.616 partos de fora.

Nos três casos o SQL rodou, o número era verossímil e ninguém tinha como
desconfiar. Este módulo mostra o mapeamento ANTES da consulta e devolve o
controle a quem pergunta: o modelo propõe, o usuário confirma, o código executa.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from .config import settings
from .db import Database
from .llm import complete
from .value_linker import _MIN_TERM_LEN, _STOPWORDS, strip_accents

# Quantos candidatos por fonte. Acima disso o painel vira uma lista que ninguém
# lê, e a escolha deixa de ser uma conferência para virar um trabalho.
LIMITE_POR_FONTE = 25


@dataclass
class Candidato:
    """Um código que talvez pertença ao conceito, com o peso que ele tem."""

    fonte: str  # "procedimento" | "cid"
    coluna: str  # a coluna do fato onde ele é filtrado
    codigo: str
    descricao: str
    internacoes: int
    # A proposta do modelo, que o usuário pode desfazer.
    sugerido: bool = False
    motivo: str = ""


@dataclass
class Conceito:
    termo: str
    candidatos: list[Candidato] = field(default_factory=list)
    # Aviso do dicionário que se aplique a este termo (COVID, câncer, óbito…).
    alerta: str = ""
    # Quantas internações a seleção sugerida cobre. É uma CONTAGEM, nunca a soma
    # dos candidatos: procedimento e diagnóstico descrevem as MESMAS internações,
    # e somar os dois deu 43.564.593 para "parto" quando a união é 25.010.349.
    # Foi o primeiro número errado que este módulo produziu — o mesmo defeito que
    # ele existe para impedir.
    total: int = 0


CLASSIFICA_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["itens", "alerta"],
    "properties": {
        "itens": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["codigo", "pertence", "motivo"],
                "properties": {
                    "codigo": {"type": "string", "description": "O código exato, como veio."},
                    "pertence": {
                        "type": "boolean",
                        "description": "Este código É o conceito perguntado, ou apenas o menciona?",
                    },
                    "motivo": {
                        "type": "string",
                        "description": "Meia linha. Vazio quando pertence=true e é óbvio.",
                    },
                },
            },
        },
        "alerta": {
            "type": "string",
            "description": (
                "Uma frase, só se houver armadilha conhecida neste termo nesta base "
                "(código oficial ausente, conceito que abrange mais do que o nome sugere). "
                "Vazio se não houver."
            ),
        },
    },
}

CLASSIFICA_PROMPT = """\
Você separa, numa lista de códigos do SIH/SUS, quais SÃO o conceito perguntado e
quais apenas o MENCIONAM.

A distinção é entre ser e citar:
- "PARTO NORMAL" É um parto. "ANALGESIA OBSTETRICA P/ PARTO NORMAL" não é: é a
  anestesia de um parto. "TRATAMENTO DE TRAUMATISMO DE PARTO NO NEONATO" não é:
  é a internação do bebê.
- "PARTO CESARIANO C/ LAQUEADURA TUBARIA" É um parto — a laqueadura é um
  adicional, o procedimento principal continua sendo o parto.
- Cadastro, licenciamento, inspeção sanitária e incentivo financeiro NUNCA são o
  procedimento clínico.

Na dúvida entre incluir e excluir, INCLUA e explique no motivo. Quem pergunta vê
a lista e desmarca; o que ele não vê, não desmarca.

O campo `alerta` é para armadilha desta base, não para observação genérica.
Exemplos do que merece alerta:
- o código oficial do conceito não existe aqui e ele foi registrado em outro;
- o conjunto marcado abrange bem mais do que o nome sugere (por exemplo,
  "neoplasias" incluindo tumor benigno quando a pessoa perguntou "câncer").
Se não houver nada assim, devolva vazio.
"""


EXPANDE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["termos"],
    "properties": {
        "termos": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3 a 8 palavras isoladas, em português, sem acento e no singular.",
        }
    },
}

EXPANDE_PROMPT = """\
Dado um termo clínico, liste as PALAVRAS que apareceriam no nome de um
procedimento ou de um diagnóstico CID-10 que corresponda a ele.

A busca no banco é literal. "covid" não casa com "Infecc p/coronavirus NE", que
é onde a COVID está registrada nesta base — por isso o termo tem de ser
expandido antes.

Devolva o próprio termo mais os sinônimos e o vocabulário técnico:
- "covid" → covid, coronavirus, sars
- "infarto" → infarto, miocardio, isquemic
- "avc" → cerebrovascular, cerebral, isquemic, hemorrag
- "parto" → parto, cesarian, cesarea

Palavras isoladas, minúsculas, sem acento, no singular. Nada de frases.
Prefira o RADICAL quando a flexão variar ("cesarian" cobre cesariana e
cesariano). Não invente termo sem relação com o conceito.
"""


def _expande(termo: str) -> list[str]:
    """Sinônimos e vocabulário técnico do termo, para a busca literal alcançá-los.

    Sem esta etapa, "covid" devolvia só o procedimento cujo nome traz a palavra
    e perdia B342 — 1.435.980 internações, a maior parte do conceito.
    """
    try:
        r = complete(
            model=settings.sql_model,
            system=EXPANDE_PROMPT,
            messages=[{"role": "user", "content": termo}],
            schema=EXPANDE_SCHEMA,
            schema_name="expande_termo",
            reasoning_effort="low",
        )
        extras = [str(t) for t in r.get("termos", [])]
    except Exception:  # noqa: BLE001 — sem expansão o painel ainda funciona
        extras = []
    return [termo, *extras]


def _radicais(termos: list[str]) -> list[str]:
    """Os radicais que serão procurados nas dimensões.

    Mesma normalização do value linker — sem acento, sem palavra vazia, com o
    plural cortado — para o painel achar o mesmo que o agente acha.
    """
    saida: list[str] = []
    for palavra in re.findall(r"[A-Za-zÀ-ÿ]+", " ".join(termos).lower()):
        base = strip_accents(palavra)
        # O piso de 5 letras do value linker existe para não casar palavra
        # curta demais numa PERGUNTA inteira. Aqui o termo já foi escolhido a
        # dedo, então 4 basta — senão "sars" e "avc" nunca chegariam à busca.
        if base in _STOPWORDS or len(base) < 4:
            continue
        radical = base[:-2] if base.endswith(("as", "es")) else base
        if len(radical) >= 4 and radical not in saida:
            saida.append(radical)
    return saida


def _padrao(radicais: list[str]) -> str:
    # `\b` é a fronteira de palavra do RE2, que é o motor do DuckDB. O `\y` do
    # PostgreSQL não casa nada aqui — foi o bug que fez %dias% pegar
    # "clamiDIAS" e "meDIAStino" no value linker.
    return "|".join(re.escape(r) for r in radicais)


def _candidatos_procedimento(db: Database, padrao: str) -> list[Candidato]:
    """Procedimentos cujo nome cita o termo, com quantas internações cada um tem."""
    sql = f"""
    WITH achados AS (
        SELECT PROC_REA, NOME_PROC FROM procedimentos
        WHERE regexp_matches(strip_accents(lower(NOME_PROC)), '\\b({padrao})')
        LIMIT {LIMITE_POR_FONTE}
    )
    SELECT a.PROC_REA, a.NOME_PROC, COUNT(i.PROC_REA) AS n
    FROM achados a LEFT JOIN internacoes i ON i.PROC_REA = a.PROC_REA
    GROUP BY 1, 2 ORDER BY 3 DESC
    """
    return [
        Candidato("procedimento", "PROC_REA", cod, nome, int(n))
        for cod, nome, n in db.run(sql, add_limit=False).rows
    ]


def _candidatos_cid(db: Database, padrao: str) -> list[Candidato]:
    """Códigos CID cujo nome cita o termo, por volume de internações.

    Categoria E subcategoria. A primeira versão filtrava `TP_NIVEL = 'CAT'`
    para não devolver centenas de linhas, e com isso excluía B342 — que é
    subcategoria e é onde a COVID está, com 1.435.980 internações. O corte por
    volume faz o mesmo trabalho sem descartar o código certo.

    O LIMIT vem DEPOIS da contagem: aplicado antes, ele escolhia 25 códigos
    arbitrários e contava esses, não os 25 maiores.
    """
    sql = f"""
    WITH achados AS (
        SELECT CID, DESCRICAO, TP_NIVEL FROM cid
        WHERE regexp_matches(strip_accents(lower(DESCRICAO)), '\\b({padrao})')
    ), contados AS (
        SELECT a.CID, a.DESCRICAO, a.TP_NIVEL,
               COUNT(i.DIAG_PRINC) AS n
        FROM achados a
        LEFT JOIN internacoes i
               ON i.DIAG_PRINC = a.CID
               OR (a.TP_NIVEL = 'CAT' AND LEFT(i.DIAG_PRINC, 3) = a.CID)
        GROUP BY 1, 2, 3
    )
    SELECT CID, DESCRICAO, TP_NIVEL, n FROM contados
    WHERE n > 0 ORDER BY n DESC LIMIT {LIMITE_POR_FONTE}
    """
    saida = []
    for cod, desc, nivel, n in db.run(sql, add_limit=False).rows:
        # Categoria filtra pelos 3 primeiros dígitos; subcategoria, pelo código
        # inteiro. A coluna carrega essa diferença para a cláusula final.
        coluna = "DIAG_PRINC_CAT" if nivel == "CAT" else "DIAG_PRINC"
        saida.append(Candidato("cid", coluna, cod, desc, int(n)))
    return saida


def _classifica(termo: str, candidatos: list[Candidato]) -> tuple[list[Candidato], str]:
    """Marca quais candidatos pertencem ao conceito. Uma chamada de LLM.

    Se a chamada falhar, todos voltam sugeridos: um painel completo que o
    usuário poda é melhor que nenhum painel.
    """
    if not candidatos:
        return candidatos, ""

    listagem = "\n".join(
        f"{c.codigo} | {c.descricao} | {c.internacoes} internações" for c in candidatos
    )
    try:
        r = complete(
            model=settings.sql_model,
            system=CLASSIFICA_PROMPT,
            messages=[
                {"role": "user", "content": f'Conceito perguntado: "{termo}"\n\nCódigos:\n{listagem}'}
            ],
            schema=CLASSIFICA_SCHEMA,
            schema_name="classifica_conceito",
            reasoning_effort="low",
        )
    except Exception:  # noqa: BLE001
        for c in candidatos:
            c.sugerido = True
        return candidatos, ""

    por_codigo = {str(i.get("codigo", "")).strip(): i for i in r.get("itens", [])}
    for c in candidatos:
        item = por_codigo.get(c.codigo)
        c.sugerido = bool(item.get("pertence")) if item else True
        c.motivo = str(item.get("motivo", "") if item else "").strip()
    return candidatos, str(r.get("alerta", "")).strip()


def resolve(db: Database, termo: str) -> Conceito:
    """Resolve o termo nos códigos que ele significa, com contagem e proposta."""
    radicais = _radicais(_expande(termo))
    if not radicais:
        return Conceito(termo=termo)

    padrao = _padrao(radicais)
    candidatos = _candidatos_procedimento(db, padrao) + _candidatos_cid(db, padrao)
    # Códigos que nunca aparecem no fato não ajudam a decidir nada.
    candidatos = [c for c in candidatos if c.internacoes > 0]
    candidatos, alerta = _classifica(termo, candidatos)
    conceito = Conceito(termo=termo, candidatos=candidatos, alerta=alerta)
    conceito.total = contar(db, [c for c in candidatos if c.sugerido])
    return conceito


_CODIGO_VALIDO = re.compile(r"^[A-Za-z0-9.]{1,12}$")


def _condicao(selecionados: list[Candidato]) -> str:
    """O predicado SQL da seleção. Os códigos vêm do cliente, então são
    conferidos contra um formato estrito antes de entrar na query."""
    por_coluna: dict[str, list[str]] = {}
    for c in selecionados:
        if c.coluna not in ("PROC_REA", "DIAG_PRINC", "DIAG_PRINC_CAT"):
            continue
        if not _CODIGO_VALIDO.match(c.codigo):
            continue
        por_coluna.setdefault(c.coluna, []).append(c.codigo)

    partes = []
    for coluna, codigos in por_coluna.items():
        lista = ", ".join(f"'{c}'" for c in sorted(set(codigos)))
        alvo = "LEFT(DIAG_PRINC,3)" if coluna == "DIAG_PRINC_CAT" else coluna
        partes.append(f"{alvo} IN ({lista})")
    return " OR ".join(partes)


def contar(db: Database, selecionados: list[Candidato]) -> int:
    """Quantas internações a seleção cobre, DE VERDADE.

    Uma internação de parto tem procedimento E diagnóstico de parto; contá-la
    nas duas fontes a conta duas vezes. Só o banco sabe a união.
    """
    cond = _condicao(selecionados)
    if not cond:
        return 0
    sql = f"SELECT COUNT(*) FROM internacoes WHERE {cond}"
    return int(db.run(sql, add_limit=False).rows[0][0])


def clausula(termo: str, selecionados: list[Candidato]) -> str:
    """Traduz a escolha do usuário numa frase que o gerador de SQL obedece.

    Uma frase e não um pedaço de SQL: o gerador ainda precisa montar a consulta
    inteira, e receber SQL pronto no meio da pergunta o confunde mais do que
    ajuda. A frase também aparece no histórico e no trace, então a definição
    fica registrada junto da resposta.
    """
    cond = _condicao(selecionados)
    if not cond:
        return ""
    return (
        f'Considere "{termo}" como exatamente as internações em que {cond}. '
        f"Esta definição foi conferida pelo usuário: não a altere, não a amplie "
        f"e não acrescente outros códigos."
    )


def para_json(c: Conceito) -> dict:
    return {
        "term": c.termo,
        "alert": c.alerta,
        "total": c.total,
        "candidates": [
            {
                "source": x.fonte,
                "column": x.coluna,
                "code": x.codigo,
                "description": x.descricao,
                "admissions": x.internacoes,
                "suggested": x.sugerido,
                "note": x.motivo,
            }
            for x in c.candidatos
        ],
    }


def de_json(dados: dict) -> list[Candidato]:
    """Reconstrói os candidatos que o frontend devolveu marcados."""
    return [
        Candidato(
            fonte=str(d.get("source", "")),
            coluna=str(d.get("column", "")),
            codigo=str(d.get("code", "")),
            descricao=str(d.get("description", "")),
            internacoes=int(d.get("admissions", 0)),
            sugerido=True,
        )
        for d in dados
        if d.get("code") and d.get("column")
    ]


__all__ = [
    "Candidato", "Conceito", "resolve", "contar", "clausula",
    "para_json", "de_json", "asdict",
]
