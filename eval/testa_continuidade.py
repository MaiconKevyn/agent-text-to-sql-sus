"""Testa a declaração de continuidade — e o isolamento da avaliação.

Duas coisas distintas são verificadas aqui:

  ISOLAMENTO (roda sem gastar chamada de LLM)
    A avaliação chama `agent.ask(pergunta)` sem histórico. O campo
    `continuidade` só existe no schema quando HÁ histórico, então o caminho da
    avaliação recebe exatamente o contrato de antes. Isso é conferido lendo os
    schemas, não confiando na intenção.

  COMPORTAMENTO (gasta chamadas de LLM)
    Uma pergunta inicial e três continuações, incluindo a que falhava em
    silêncio: depois de "quantas mortes por covid?", a pergunta "em quais
    estados tiveram mais mortes?" devolvia 903.064 (todas as causas) no lugar
    de 38.884 (covid).

    python3 eval/testa_continuidade.py            # só o isolamento
    python3 eval/testa_continuidade.py --completo # tudo
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.agent import Turn  # noqa: E402
from src.llm import SQL_SCHEMA, SQL_SCHEMA_COM_HISTORICO  # noqa: E402

# O filtro que a pergunta inicial estabelece. Toda continuação sobre o mesmo
# assunto tem de mantê-lo — é a única verificação objetiva possível.
MARCA_COVID = "B342"

PERGUNTA_INICIAL = "Quantas mortes por covid?"

# (pergunta, deve manter o filtro?, por quê)
CONTINUACOES = [
    ("E por estado?", True, "elíptica — sempre funcionou"),
    (
        "Em quais estados tiveram mais mortes?",
        True,
        "frase completa, mesmo assunto — é o caso que falhava",
    ),
    (
        "Qual o custo médio de internação no Rio Grande do Sul?",
        False,
        "assunto realmente novo — não deve arrastar o filtro",
    ),
]


def testa_isolamento() -> bool:
    """A avaliação não pode enxergar o campo novo."""
    print("ISOLAMENTO DA AVALIAÇÃO")
    ok = True

    if "continuidade" in SQL_SCHEMA["properties"]:
        print("  FALHA  o schema base ganhou `continuidade` — a avaliação seria afetada")
        ok = False
    else:
        print("  ok     schema base não tem `continuidade`")

    if "continuidade" in SQL_SCHEMA["required"]:
        print("  FALHA  `continuidade` virou obrigatório no schema base")
        ok = False
    else:
        print(f"  ok     obrigatórios do schema base inalterados: {sorted(SQL_SCHEMA['required'])}")

    if "continuidade" not in SQL_SCHEMA_COM_HISTORICO["properties"]:
        print("  FALHA  o schema com histórico não tem o campo")
        ok = False
    else:
        print("  ok     schema com histórico tem `continuidade`")

    # O resto dos campos tem de ser idêntico entre os dois.
    base = set(SQL_SCHEMA["properties"])
    com = set(SQL_SCHEMA_COM_HISTORICO["properties"]) - {"continuidade"}
    if base != com:
        print(f"  FALHA  os schemas divergem em outros campos: {base ^ com}")
        ok = False
    else:
        print("  ok     os dois schemas só diferem por `continuidade`")

    # E a avaliação, de fato, não passa histórico.
    fonte = (Path(__file__).parent / "run_eval.py").read_text()
    if "agent.ask(case[\"question\"])" in fonte:
        print("  ok     run_eval.py chama ask() sem histórico")
    else:
        print("  ATENÇÃO  não encontrei a chamada esperada em run_eval.py — confira à mão")
    return ok


def testa_comportamento() -> bool:
    from src.agent import TextToSQLAgent

    print("\nCOMPORTAMENTO DAS CONTINUAÇÕES")
    agente = TextToSQLAgent()

    r0 = agente.ask(PERGUNTA_INICIAL)
    if not r0.sql or MARCA_COVID not in r0.sql:
        print(f"  a pergunta inicial não usou {MARCA_COVID}; teste inconclusivo")
        print(f"  SQL: {' '.join((r0.sql or '').split())[:160]}")
        return False
    print(f"  inicial: {PERGUNTA_INICIAL}")
    print(f"           filtro {MARCA_COVID} presente · {r0.answer[:90]}")

    historico = [Turn(question=PERGUNTA_INICIAL, sql=r0.sql)]
    passou = 0
    for pergunta, deve_manter, porque in CONTINUACOES:
        r = agente.ask(pergunta, history=historico)
        sql = " ".join((r.sql or "").split())
        manteve = MARCA_COVID in sql

        cont = getattr(r, "continuity", None) or {}
        tipo = cont.get("kind", "(não declarou)")
        descartado = cont.get("dropped", [])

        # O acerto é o SQL fazer o certo E a declaração bater com o SQL.
        certo = manteve == deve_manter
        coerente = (tipo == "acompanhamento") == manteve if tipo != "(não declarou)" else False
        ok = certo and coerente
        passou += ok

        print(f"\n  {'OK   ' if ok else 'FALHA'} {pergunta}")
        print(f"         ({porque})")
        print(f"         esperava manter={deve_manter} · manteve={manteve}")
        print(f"         declarou: {tipo}" + (f" · descartou {descartado}" if descartado else ""))
        if not certo:
            print(f"         SQL: {sql[:150]}")
        if certo and not coerente:
            print("         ⚠ o SQL está certo mas a declaração não bate com ele")

    print(f"\n  {passou}/{len(CONTINUACOES)} continuações corretas e coerentes")
    return passou == len(CONTINUACOES)


def main() -> int:
    ok = testa_isolamento()
    if "--completo" in sys.argv:
        ok = testa_comportamento() and ok
    else:
        print("\n(use --completo para testar também o comportamento, que gasta chamadas de LLM)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
