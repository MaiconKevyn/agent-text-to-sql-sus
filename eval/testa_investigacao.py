"""Testa o harness de investigação em perguntas que o fluxo de pergunta única
não dá conta.

O que se quer verificar não é "rodou", é:
  - o plano comparou em vez de só contar;
  - a reflexão pegou algum buraco no argumento;
  - o texto final não afirmou causa nem trocou internação por pessoa;
  - o custo e o tempo cabem num produto interativo.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.investigate import Investigador, Relatorio  # noqa: E402

CASOS = [
    # Investigação de relação: exige denominador, senão a conclusão é falsa.
    "Existe alguma relação entre internações por câncer e a idade do paciente?",
    # Pergunta composta: três perguntas de uma vez.
    (
        "Como a pandemia afetou as internações? Quero saber a queda em 2020, "
        "quais especialidades caíram mais e se a mortalidade hospitalar subiu."
    ),
]

# Palavras que denunciam afirmação causal ou troca de unidade.
CAUSAL = ("causa ", "causam", "provoca", "leva a ", "devido ao aumento", "por causa de")
UNIDADE = ("pessoas morreram", "x pessoas", "pacientes foram", "indivíduos internados")


def relata(rel: Relatorio) -> None:
    print(f"\n{'=' * 78}\nPERGUNTA: {rel.pergunta}")
    print(f"{'=' * 78}")
    if rel.recusa:
        print(f"RECUSOU: {rel.recusa}")
        return

    print(f"\nLeitura do planejador:\n  {rel.leitura[:300]}")
    print(f"\nEtapas ({rel.etapas_ok}/{len(rel.achados)} com resultado):")
    for a in rel.achados:
        marca = "ok  " if a.ok else "FALHA"
        origem = "↻" if a.origem == "reflexao" else " "
        linhas = f"{len(a.resultado.rows)} linha(s)" if a.resultado else (a.erro or "")[:60]
        print(f"  {marca} {origem} {a.pergunta[:74]}")
        print(f"          {linhas}   ·   {a.proposito[:64]}")

    if rel.lacuna:
        print(f"\nLacuna NÃO fechada: {rel.lacuna[:220]}")

    print(f"\n--- TEXTO FINAL ---\n{rel.texto}\n")

    baixo = rel.texto.lower()
    avisos = []
    if achou := [p for p in CAUSAL if p in baixo]:
        avisos.append(f"linguagem causal: {achou}")
    if achou := [p for p in UNIDADE if p in baixo]:
        avisos.append(f"trocou internação por pessoa: {achou}")
    if "internaç" not in baixo:
        avisos.append("o texto nem menciona 'internações' — a unidade sumiu")
    for w in avisos:
        print(f"  ⚠ {w}")
    if not avisos:
        print("  sem afirmação causal e com a unidade preservada")

    reflexao = sum(1 for a in rel.achados if a.origem == "reflexao")
    print(
        f"\ncusto: {rel.segundos:.0f}s · {rel.chamadas_llm} chamadas de LLM · "
        f"{len(rel.achados)} etapas ({reflexao} vindas da reflexão)"
    )


def main() -> int:
    inv = Investigador()
    for pergunta in CASOS:
        print(f"\n>>> investigando: {pergunta[:70]}…")
        relata(inv.investigar(pergunta, verboso=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
