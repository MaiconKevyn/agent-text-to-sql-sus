"""Testa a fase de reflexão isoladamente, com evidências sintéticas.

Rodar a investigação inteira para saber se a reflexão dispara é caro e não
conclui nada: se ela não dispara, pode ser porque o plano estava bom. Aqui as
evidências são construídas para ter — ou não ter — um buraco conhecido, e a
única pergunta é se a reflexão o enxerga.

Três chamadas de LLM, nenhuma varredura no banco.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.db import QueryResult  # noqa: E402
from src.investigation.models import Achado, Etapa  # noqa: E402
from src.investigation.phases import refletir  # noqa: E402


def achado(pergunta: str, proposito: str, colunas: list[str], linhas: list[list]) -> Achado:
    return Achado(
        etapa=Etapa(pergunta=pergunta, proposito=proposito),
        sql="SELECT ...",
        resultado=QueryResult(columns=colunas, rows=linhas, elapsed_s=0.1, sql="SELECT ..."),
    )


def falha(pergunta: str, proposito: str, erro: str) -> Achado:
    return Achado(etapa=Etapa(pergunta=pergunta, proposito=proposito), erro=erro)


CASOS = [
    (
        "contagem bruta sem denominador",
        "Existe relação entre internações por câncer e a faixa etária?",
        [
            achado(
                "Quantas internações por câncer em cada faixa etária?",
                "Medir o volume por faixa",
                ["faixa", "internacoes_cancer"],
                [["0-19", 693369], ["20-39", 1293528], ["40-59", 3465554], ["60+", 3495657]],
            )
        ],
        False,  # a contagem cresce com a faixa, mas o total por faixa também pode
        "sem o total por faixa, o crescimento pode ser só volume de internações",
    ),
    (
        "etapa falhou e era necessária",
        "A mortalidade hospitalar subiu em 2020?",
        [
            achado(
                "Quantas internações por ano de 2018 a 2021?",
                "Panorama",
                ["ano", "internacoes"],
                [[2018, 9315000], [2019, 9572375], [2020, 8247368], [2021, 9010000]],
            ),
            falha(
                "Qual a taxa de óbito hospitalar por ano de 2018 a 2021?",
                "Responder a pergunta central",
                "BinderException: coluna OBITO não existe",
            ),
        ],
        False,  # a pergunta central ficou sem evidência nenhuma
        "a etapa que respondia a pergunta falhou",
    ),
    (
        "evidência completa, só restam limitações da base",
        "Existe relação entre internações por câncer e a faixa etária?",
        [
            achado(
                "Internações por câncer e total, por faixa etária, com a proporção",
                "Responder com proporção, não contagem",
                ["faixa", "cancer", "total", "pct"],
                [
                    ["0-19", 693369, 33495046, 2.07],
                    ["20-39", 1293528, 46161968, 2.80],
                    ["40-59", 3465554, 29646985, 11.69],
                    ["60+", 3495657, 35082773, 9.96],
                ],
            ),
            achado(
                "A mesma proporção, quebrada por sexo",
                "Testar confusão por sexo",
                ["faixa", "sexo", "pct"],
                [["40-59", "F", 12.9], ["40-59", "M", 10.2], ["60+", "F", 9.8], ["60+", "M", 10.1]],
            ),
        ],
        True,  # o que sobra (falta de denominador populacional) é ressalva, não query
        "o que falta é limitação da base, resolvida com ressalva no texto",
    ),
]


def main() -> int:
    passou = 0
    for nome, pergunta, achados, esperado_suficiente, porque in CASOS:
        r = refletir(pergunta, achados, restante=3)
        obtido = r.suficiente
        extras = r.etapas_extras
        ok = obtido == esperado_suficiente
        passou += ok

        print(f"\n{'OK   ' if ok else 'FALHA'} {nome}")
        print(f"      esperava suficiente={esperado_suficiente} ({porque})")
        print(f"      obteve   suficiente={obtido}, {len(extras)} etapa(s) extra(s)")
        if r.defeitos:
            print(f"      defeitos: {', '.join(r.defeitos)}")
        if r.observacao:
            print(f"      observação: {r.observacao[:150]}")
        for e in extras[:3]:
            print(f"        + {e.pergunta[:100]}")

    print(f"\n{passou}/{len(CASOS)} casos passaram")
    return 0 if passou == len(CASOS) else 1


if __name__ == "__main__":
    sys.exit(main())
