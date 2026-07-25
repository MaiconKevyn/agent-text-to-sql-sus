"""Executa todo o ground truth e grava um snapshot dos resultados de referência.

Rode sempre que `ground_truth.yaml` mudar. O snapshot serve para (a) revisar à
mão se o gold faz sentido e (b) acelerar a avaliação.

    python -m eval.build_gold
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings  # noqa: E402
from src.db import Database  # noqa: E402

OUT = Path(__file__).resolve().parent / "gold_snapshot.json"


def jsonable(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def main() -> int:
    with open(settings.ground_truth_file, encoding="utf-8") as fh:
        cases = yaml.safe_load(fh)["cases"]

    db = Database()
    snapshot: dict[str, dict] = {}
    problems: list[str] = []
    n_answerable = 0

    for case in cases:
        cid = case["id"]
        if case.get("answerable", True) is False:
            snapshot[cid] = {"answerable": False}
            print(f"  {cid:<34} [irrespondível]")
            continue

        n_answerable += 1
        try:
            res = db.run(case["gold_sql"], add_limit=False)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{cid}: ERRO — {exc}")
            print(f"  {cid:<34} ✗ ERRO: {exc}")
            continue

        if not res.rows and not case.get("expect_empty"):
            problems.append(f"{cid}: resultado VAZIO")

        snapshot[cid] = {
            "answerable": True,
            "sql": case["gold_sql"].strip(),
            "columns": res.columns,
            "rows": [[jsonable(v) for v in r] for r in res.rows],
            "n_rows": len(res.rows),
            "elapsed_s": round(res.elapsed_s, 3),
        }
        preview = res.rows[0] if res.rows else "(vazio — esperado)"
        flag = "ok" if res.rows or case.get("expect_empty") else "✗ VAZIO"
        print(f"  {cid:<34} {flag:<8} {len(res.rows):>4} linhas  {res.elapsed_s:6.2f}s  {str(preview)[:70]}")

    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{len(cases)} casos ({n_answerable} respondíveis, "
          f"{len(cases) - n_answerable} irrespondíveis) -> {OUT.name}")
    if problems:
        print(f"\n⚠ {len(problems)} problema(s):")
        for p in problems:
            print("   ", p)
        return 1
    print("Todos os golds executaram e devolveram linhas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
