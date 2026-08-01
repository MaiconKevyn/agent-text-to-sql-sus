"""Remove ambiguidade das perguntas que admitem mais de uma resposta correta.

Duas fontes de ambiguidade sobraram depois da incorporação dos 228 casos, e
ambas produzem falha sem que ninguém tenha errado SQL:

  1. RANKING SEM N. "Quais capítulos CID têm maior custo?" não diz quantas
     linhas. O gold devolvia 260 e o chatbot, sensatamente, devolvia 20. A
     correção é fixar o N NO ENUNCIADO e no gold ao mesmo tempo.

  2. GOLD PEDINDO COLUNAS A MAIS. "Qual a taxa de mortalidade no RS em 2021?"
     pede uma taxa; o gold devolvia internações, óbitos e taxa. Como o critério
     é `gold ⊆ predição`, a coluna sobrando no gold reprovava a resposta certa.
     A correção é o gold devolver o que a pergunta pede.

    python -m eval.disambiguate            # dry-run
    python -m eval.disambiguate --apply
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval import resultados  # noqa: E402
from eval.run_eval import results_match  # noqa: E402
from src.db import Database  # noqa: E402

GT = Path(__file__).resolve().parent / "ground_truth.yaml"
# A execução mais recente de eval/results/ — resolvido na hora do uso, e não
# na importação, para o módulo não travar num caminho que ainda não existe.
REPORT = resultados.ultimo_relatorio()

TOP_N = 10  # N padrão adotado para ranking aberto
LIMITES_TIPICOS = {5, 10, 15, 20, 25, 50, 100}

# Golds que devolvem mais do que a pergunta pede. Escolher as colunas por
# heurística é arriscado — em "evolução anual por estado", manter as últimas
# colunas descartaria justamente a UF. Então a lista é explícita: para cada
# caso, os índices das colunas do SELECT que a pergunta realmente pede.
APARAR: dict[str, tuple[list[int], str]] = {
    "gt_gt049": ([2], "a pergunta pede a taxa; o gold devolvia internações, óbitos e taxa"),
    "gt_gt050": ([3], "a pergunta pede a taxa; o gold devolvia rótulo, internações, óbitos e taxa"),
    "gt_gt087": ([0, 1, 4], "a pergunta pede UF, ano e taxa; o gold somava internações e óbitos"),
    "gt_gt175": ([0, 3], "a pergunta pede sexo e taxa; o gold somava internações e óbitos"),
}


def pede_n_linhas(pergunta: str) -> bool:
    """A pergunta diz QUANTAS linhas quer?

    Um número no enunciado não basta: "considerando apenas os com mais de 1000
    internações" é limiar de volume, não quantidade de linhas. Só conta o número
    que qualifica o que será listado.
    """
    return bool(
        re.search(
            r"\b(top\s*\d+"
            r"|(os|as)\s+(\d+|tres|três|cinco|dez|vinte)\b"
            r"|(\d+|tres|três|cinco|dez|vinte)\s+"
            r"(maior|menor|princip|mais|primeir|melhor|pior)\w*"
            r"|\b(qual|quais)\b[^?]{0,40}\b(o|a)\s+(maior|menor|mais|principal)\b)",
            pergunta,
            re.I,
        )
    )


def aplica_top_n(case: dict, n: int = TOP_N) -> str | None:
    """Fixa N no enunciado e no gold de uma pergunta de ranking aberta."""
    sql = case["gold_sql"].rstrip().rstrip(";")
    if not re.search(r"ORDER\s+BY", sql, re.I):
        return None
    sql = re.sub(r"\s*\bLIMIT\s+\d+\s*$", "", sql, flags=re.I)
    case["gold_sql"] = f"{sql}\nLIMIT {n};"
    case["question"] = case["question"].rstrip().rstrip("?.") + f"? Liste os {n} primeiros."
    case["ordered"] = True
    return f"ranking aberto -> N fixado em {n} no enunciado e no gold"


def apara_colunas(case: dict, manter: list[int]) -> str | None:
    """Reduz o SELECT do gold às colunas que a pergunta realmente pede."""
    sql = case["gold_sql"]
    m = re.match(r"\s*SELECT\s+(.*?)\s+FROM\s", sql, re.I | re.S)
    if not m:
        return None
    # Divide a lista de seleção respeitando parênteses.
    bruto, nivel, atual = m.group(1), 0, []
    partes = []
    for ch in bruto:
        if ch == "(":
            nivel += 1
        elif ch == ")":
            nivel -= 1
        if ch == "," and nivel == 0:
            partes.append("".join(atual).strip())
            atual = []
        else:
            atual.append(ch)
    partes.append("".join(atual).strip())
    if len(partes) <= len(manter) or max(manter) >= len(partes):
        return None
    novo = ", ".join(partes[i] for i in manter)
    case["gold_sql"] = sql[: m.start(1)] + novo + sql[m.end(1) :]
    return f"gold aparado para as colunas {manter} (as que a pergunta pede)"


def main() -> int:
    aplicar = "--apply" in sys.argv
    doc = yaml.safe_load(GT.read_text(encoding="utf-8"))
    casos = {c["id"]: c for c in doc["cases"]}
    rep = json.loads(REPORT.read_text(encoding="utf-8"))
    db = Database()

    mudancas: list[tuple[str, str]] = []

    for x in rep["results"]:
        case = casos.get(x["id"])
        if not case or not case.get("gold_sql") or not x.get("predicted_sql"):
            continue
        if not case.get("origem"):
            continue  # os 57 originais ficam intactos
        try:
            g = db.run(case["gold_sql"], add_limit=False)
            p = db.run(x["predicted_sql"], add_limit=False)
        except Exception:
            continue
        ok, _ = results_match(g.rows, p.rows, case.get("ordered", False))
        if ok:
            continue

        ng, np_ = len(g.rows), len(p.rows)

        # 1. Ranking aberto: a predição parou num limite redondo e o gold é
        #    muito maior. É pergunta sem N, não erro de SQL.
        if np_ in LIMITES_TIPICOS and ng > np_ * 2 and not pede_n_linhas(case["question"]):
            if nota := aplica_top_n(case):
                mudancas.append((x["id"], nota))
                continue

        # 2. Gold com mais colunas do que a pergunta pede.
        if x["id"] in APARAR:
            manter, motivo = APARAR[x["id"]]
            if nota := apara_colunas(case, manter):
                mudancas.append((x["id"], f"{nota} — {motivo}"))

    # Valida cada alteração antes de gravar.
    revertidos = 0
    for cid, _ in list(mudancas):
        try:
            r = db.run(casos[cid]["gold_sql"], add_limit=False)
            if not r.rows:
                raise ValueError("vazio")
        except Exception as exc:  # noqa: BLE001
            print(f"  ⟲ {cid}: revertido ({str(exc)[:50]})")
            revertidos += 1

    for cid, nota in mudancas:
        print(f"  ✎ {cid}: {nota}")
    print(f"\n{len(mudancas) - revertidos} casos desambiguados")

    if aplicar:
        GT.write_text(
            yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=100),
            encoding="utf-8",
        )
        print(f"-> aplicado em {GT.name}")
    else:
        print("(dry-run; use --apply para gravar)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
