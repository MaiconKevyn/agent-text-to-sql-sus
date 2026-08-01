"""Reavalia um relatório existente com o critério atual, sem chamar o LLM.

Serve para separar mudança de SCORER de mudança de SISTEMA: as predições são as
mesmas: só o julgamento muda. Reexecuta o SQL previsto e o gold no banco e
compara com `results_match`.

    python -m eval.rescore [caminho/para/relatorio.json]

Sem argumento, usa a execução mais recente de eval/results/.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval import resultados  # noqa: E402
from eval.run_eval import results_match  # noqa: E402
from src.config import settings  # noqa: E402
from src.db import Database  # noqa: E402


def main() -> int:
    report_path = Path(sys.argv[1]) if len(sys.argv) > 1 else resultados.ultimo_relatorio()
    if report_path is None:
        print("Nenhuma execução em eval/results/. Rode `python -m eval.run_eval` antes.")
        return 1
    report = json.loads(report_path.read_text(encoding="utf-8"))
    cases = {
        c["id"]: c
        for c in yaml.safe_load(open(settings.ground_truth_file, encoding="utf-8"))["cases"]
    }

    db = Database()
    by_cat: dict[str, list[bool]] = defaultdict(list)
    modos: dict[str, int] = defaultdict(int)
    linhas, mudou = [], []

    for rec in report["results"]:
        cid = rec["id"]
        case = cases.get(cid)
        if case is None:
            continue
        antes = rec["correct"]

        if not rec["expect_answerable"]:
            ok, modo = (not rec.get("got_answerable", True)), "recusa"
        elif not rec.get("got_answerable", True):
            ok, modo = False, "recusou indevidamente"
        elif not rec.get("predicted_sql"):
            ok, modo = False, "sem SQL"
        else:
            try:
                pred = db.run(rec["predicted_sql"], add_limit=False)
                gold = db.run(case["gold_sql"], add_limit=False)
                ok, modo = results_match(
                    gold.rows, pred.rows, case.get("ordered", False)
                )
            except Exception as exc:  # noqa: BLE001
                ok, modo = False, f"erro: {type(exc).__name__}"

            if ok and (req := case.get("answer_must_mention")):
                a = (rec.get("answer") or "").lower()
                if any(not any(alt.lower() in a for alt in alts) for alts in req):
                    ok, modo = False, "sem ressalva"

        by_cat[rec["category"]].append(ok)
        modos[modo] += 1
        linhas.append((cid, rec["category"], ok, modo))
        if ok != antes:
            mudou.append((cid, antes, ok, modo))

    n = len(linhas)
    n_ok = sum(1 for _, _, ok, _ in linhas if ok)
    resp = [l for l in linhas if cases[l[0]].get("answerable", True)]
    irresp = [l for l in linhas if not cases[l[0]].get("answerable", True)]

    print(f"{'id':<34} {'categoria':<20} {'':<3} modo")
    print("-" * 78)
    for cid, cat, ok, modo in linhas:
        print(f"{cid:<34} {cat:<20} {'✓' if ok else '✗'}  {modo}")

    print("\n" + "=" * 78)
    print(f"ACURÁCIA GERAL        {n_ok}/{n}  ({100*n_ok/n:.1f}%)")
    print(f"Execution accuracy    {sum(1 for l in resp if l[2])}/{len(resp)}  "
          f"({100*sum(1 for l in resp if l[2])/len(resp):.1f}%)")
    print(f"Recusa correta        {sum(1 for l in irresp if l[2])}/{len(irresp)}")
    print("\nModos de casamento:")
    for m, c in sorted(modos.items(), key=lambda kv: -kv[1]):
        print(f"  {m:<24} {c}")
    print("\nPor categoria:")
    for cat, vals in sorted(by_cat.items(), key=lambda kv: sum(kv[1]) / len(kv[1])):
        print(f"  {cat:<22} {sum(vals)}/{len(vals)}  ({100*sum(vals)/len(vals):.0f}%)")

    print(f"\nMudaram de veredito com o novo critério: {len(mudou)}")
    for cid, antes, agora, modo in mudou:
        print(f"  {cid:<34} {antes} -> {agora}  ({modo})")

    falhas = [l for l in linhas if not l[2]]
    if falhas:
        print(f"\nFalhas remanescentes ({len(falhas)}):")
        for cid, cat, _, modo in falhas:
            print(f"  ✗ {cid:<34} [{modo}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
