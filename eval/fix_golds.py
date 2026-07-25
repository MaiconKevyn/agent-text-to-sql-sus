"""Corrige defeitos sistemáticos nos golds importados dos 228 casos.

Cada regra tem uma razão INDEPENDENTE do que o modelo respondeu — ou uma regra
documentada em knowledge/schema.yaml, ou um erro objetivo de SQL. Nenhum gold é
alterado só porque o modelo discordou; isso seria ajustar a régua ao resultado.

  1. UTI            `VAL_UTI > 0` -> `MARCA_UTI > 0` quando a pergunta é sobre
                    USAR UTI. O dicionário define MARCA_UTI como o indicador;
                    VAL_UTI é valor faturado e só vale em pergunta de custo.
  2. LIMIT arbitrário  gold com `LIMIT 10` numa pergunta que não pede top-N.
  3. Município      `GROUP BY NO_MUNICIPIO` sem SG_UF funde homônimos — há
                    'Bom Jesus' em 5 UFs. Passa a agrupar pelo código.
  4. INNER JOIN     dimensões com códigos órfãos (cid, instrucao) perdem linhas
                    em silêncio. O dicionário manda LEFT JOIN nesses casos.

    python -m eval.fix_golds          # mostra o que mudaria
    python -m eval.fix_golds --apply
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import Database  # noqa: E402

GT = Path(__file__).resolve().parent / "ground_truth.yaml"

# O LIMIT do gold é mantido quando a pergunta pede um top-N explícito
# ("os 10 maiores") OU um superlativo singular ("qual o município com maior…",
# "em qual ano ocorreu o maior…"), que também exige uma única linha.
RE_TOP_N = re.compile(
    r"\b(top\s*\d+"
    r"|\d+\s+(maior|menor|princip|mais|melhor|pior)"
    r"|(os|as)\s+\d+\b|tres|três|cinco|dez"
    r"|(qual|quais|em que|em qual)\b[^?]*\b(o|a)\s+(maior|menor|mais|melhor|pior)"
    r"|\bque\s+(apresenta|teve|tem|registrou)\b[^?]*\bmaior\b"
    # "o diagnóstico mais comum", "a especialidade menos frequente"
    r"|\b(o|a)\s+\w+\s+(mais|menos)\s+\w+"
    r")", re.I
)
# Perguntas de custo/valor: VAL_UTI é legítimo.
RE_CUSTO = re.compile(r"custo|valor|gasto|receita|faturad|despesa", re.I)


def corrige(case: dict) -> list[str]:
    """Aplica as correções in-place. Devolve a lista de mudanças feitas.

    Só mexe em casos importados (os que têm `origem`). Os 57 originais foram
    escritos e conferidos à mão neste projeto — reprocessá-los por regex só
    introduziria regressão.
    """
    sql = case.get("gold_sql")
    if not sql or not case.get("origem"):
        return []
    orig, mudancas = sql, []

    # 1. UTI: indicador é MARCA_UTI, não valor faturado.
    if re.search(r'"?VAL_UTI"?\s*>\s*0', sql) and not RE_CUSTO.search(case["question"]):
        sql = re.sub(r'"?VAL_UTI"?\s*>\s*0', "MARCA_UTI > 0", sql)
        sql = re.sub(r'CASE\s+WHEN\s+MARCA_UTI > 0\s+THEN 1 ELSE 0 END',
                     "CASE WHEN MARCA_UTI > 0 THEN 1 ELSE 0 END", sql)
        mudancas.append("VAL_UTI>0 -> MARCA_UTI>0 (indicador de uso de UTI)")

    # 2. LIMIT que a pergunta não pediu.
    if re.search(r"\bLIMIT\s+\d+", sql, re.I) and not RE_TOP_N.search(case["question"]):
        sql = re.sub(r"\s*\bLIMIT\s+\d+\s*;?\s*$", ";", sql, flags=re.I)
        mudancas.append("removido LIMIT que a pergunta não pede")

    # 3. Município agrupado por nome funde homônimos entre UFs.
    if re.search(r"GROUP BY\s+[\w\"]*\.?\"?NO_MUNICIPIO", sql, re.I) and "SG_UF" not in sql:
        m = re.search(r'(\w+)\."?NO_MUNICIPIO"?', sql)
        if m:
            alias = m.group(1)
            sql = re.sub(r'(SELECT\s+)', rf'\1{alias}."SG_UF" AS uf, ', sql, count=1)
            sql = re.sub(r'(GROUP BY\s+)', rf'\1{alias}."SG_UF", ', sql, count=1, flags=re.I)
            mudancas.append("agrupamento por município passa a incluir a UF")

    # 4. INNER JOIN em dimensão com órfãos descarta linhas em silêncio.
    for dim, chave in [("cid", "CID"), ("instrucao", "INSTRU")]:
        pat = rf'(?<!LEFT )\bJOIN\s+{dim}\b'
        if re.search(pat, sql, re.I):
            sql = re.sub(pat, f"LEFT JOIN {dim}", sql, flags=re.I)
            mudancas.append(f"JOIN {dim} -> LEFT JOIN ({dim} tem códigos órfãos no fato)")

    if mudancas:
        case["gold_sql"] = sql
        anterior = case.get("tests", "")
        case["tests"] = (anterior + " | Gold corrigido: " + "; ".join(mudancas))[:600]
    return mudancas


def main() -> int:
    aplicar = "--apply" in sys.argv
    doc = yaml.safe_load(GT.read_text(encoding="utf-8"))
    db = Database()

    total, revertidos = 0, 0
    for case in doc["cases"]:
        antes = case.get("gold_sql")
        mudancas = corrige(case)
        if not mudancas:
            continue
        try:
            res = db.run(case["gold_sql"], validate=False, add_limit=False)
            if not res.rows and not case.get("expect_empty"):
                raise ValueError("resultado vazio")
        except Exception as exc:  # noqa: BLE001
            case["gold_sql"] = antes
            revertidos += 1
            print(f"  ⟲ {case['id']}: revertido ({str(exc)[:60]})")
            continue
        total += 1
        print(f"  ✎ {case['id']}: {'; '.join(mudancas)}")

    print(f"\n{total} golds corrigidos, {revertidos} revertidos por falha")
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
