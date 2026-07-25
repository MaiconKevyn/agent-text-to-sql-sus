"""Valida os 228 casos de `ground_truth_228.json` contra o banco real.

O arquivo veio migrado de outro schema, então nada nele pode ser assumido como
correto. Cada caso passa por quatro checagens:

  1. EXECUTA?      a query roda no DuckDB atual sem erro
  2. DEVOLVE DADO? resultado vazio ou todo-NULL indica pergunta sem resposta
  3. TABELAS OK?   não referencia tabela inexistente, vazia ou proibida
  4. ARMADILHAS?   não cai nas armadilhas conhecidas do SIH-RD
                   (SEXO=2, CID com ponto, INNER JOIN tempo, ...)

Saída: eval/validation_228.json com o veredito de cada caso.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import Database  # noqa: E402

SRC = Path(__file__).resolve().parent / "ground_truth_228.json"
OUT = Path(__file__).resolve().parent / "validation_228.json"

# Tabelas que existem no banco mas estão vazias, e as que não existem.
VAZIAS = {"hospital", "socioeconomico"}
PROIBIDAS = {"_staging_internacoes"}


def tabelas_reais(db: Database) -> set[str]:
    return {
        r[0]
        for r in db.run(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='main'",
            validate=False,
            add_limit=False,
        ).rows
    }


def _sem_ruido(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"'(?:''|[^'])*'", "''", sql)
    # `EXTRACT(YEAR FROM i."DT_INTER")` e `SUBSTRING(x FROM 1 FOR 2)` contêm um
    # FROM que não introduz tabela nenhuma.
    sql = re.sub(r"\b(extract|substring|position|overlay|trim)\s*\([^()]*\)", " ", sql, flags=re.I)
    return sql


def tabelas_citadas(sql: str, conhecidas: set[str]) -> set[str]:
    """Tabelas que a query realmente referencia (FROM/JOIN)."""
    limpo = _sem_ruido(sql).lower()
    # O `(?![\w.]*\.)` descarta `from i."COL"`, que é referência a apelido.
    achadas = set(re.findall(r"\b(?:from|join)\s+([a-z_][a-z0-9_]*)\b(?!\s*\.)", limpo))
    ctes = set(re.findall(r"\b([a-z_][a-z0-9_]*)\s+as\s*\(", limpo))
    return achadas - ctes


def armadilhas(sql: str) -> list[str]:
    """Detecta os erros silenciosos conhecidos desta base."""
    limpo = _sem_ruido(sql)
    baixo = limpo.lower()
    achados = []

    if re.search(r'\bsexo\b[^\w]*=\s*2\b', baixo) or re.search(
        r'"sexo"\s*=\s*2\b', baixo
    ):
        achados.append("SEXO=2 (valor inexistente no fato; devolve zero linhas)")

    if re.search(r"'[A-Z]\d{2}\.\d", limpo):
        achados.append("CID com ponto (o banco guarda sem ponto)")

    if re.search(r"\bjoin\s+tempo\b", baixo) and "left join tempo" not in baixo:
        achados.append("INNER JOIN com `tempo` (a dimensão começa em 2008; descarta 2007)")

    if re.search(r"\bgestrisco\b", baixo):
        achados.append("usa GESTRISCO (corrompida: TRUE em 99,6% das linhas)")

    if re.search(r"\buti_int_to\b", baixo):
        achados.append("usa UTI_INT_TO (corrompida: zerada em 9.107.168 de 9.107.197)")

    if re.search(r"no_municipio\s*(=|like|ilike)\s*'[^']*[aeiouAEIOU]", limpo):
        m = re.search(r"no_municipio\s*(?:=|like|ilike)\s*'([^']+)'", limpo, re.I)
        if m and m.group(1) in {"Sao Paulo", "Brasilia", "Goiania", "Belem", "Vitoria"}:
            achados.append(f"nome de município sem acento: '{m.group(1)}'")

    return achados


def main() -> int:
    casos = json.loads(SRC.read_text(encoding="utf-8"))
    db = Database()
    reais = tabelas_reais(db)

    resultados = []
    for c in casos:
        sql = c["query"]
        rec: dict = {
            "id": c["id"],
            "difficulty": c.get("difficulty"),
            "question": c["question"],
            "query": sql,
            "problemas": [],
            "avisos": [],
        }

        citadas = tabelas_citadas(sql, reais)
        rec["tabelas_citadas"] = sorted(citadas)

        for t in sorted(citadas - reais):
            rec["problemas"].append(f"tabela inexistente: {t}")
        for t in sorted(citadas & VAZIAS):
            rec["problemas"].append(f"tabela VAZIA: {t}")
        for t in sorted(citadas & PROIBIDAS):
            rec["problemas"].append(f"tabela proibida: {t}")

        try:
            res = db.run(sql, validate=False, add_limit=False)
            rec["executou"] = True
            rec["n_linhas"] = len(res.rows)
            rec["colunas"] = res.columns
            rec["elapsed_s"] = round(res.elapsed_s, 3)
            rec["amostra"] = [[str(v) for v in r] for r in res.rows[:3]]
            # Vazio e zero podem ser a resposta CERTA (não há município órfão;
            # não há VAL_TOT nulo; a menor idade é mesmo 0). Viram aviso para
            # revisão manual, não reprovação automática.
            if not res.rows:
                rec["avisos"].append("resultado VAZIO — conferir se é a resposta correta")
            elif all(all(v is None for v in r) for r in res.rows):
                rec["problemas"].append("resultado todo NULL")
            elif len(res.rows) == 1 and len(res.rows[0]) == 1 and res.rows[0][0] == 0:
                rec["avisos"].append("escalar zero — conferir se é a resposta correta")
        except Exception as exc:  # noqa: BLE001
            rec["executou"] = False
            rec["erro"] = f"{type(exc).__name__}: {exc}"
            rec["problemas"].append("NÃO EXECUTA")

        for a in armadilhas(sql):
            rec["problemas"].append(f"armadilha: {a}")

        rec["ok"] = not rec["problemas"]
        resultados.append(rec)

    OUT.write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8")

    ok = [r for r in resultados if r["ok"]]
    ruins = [r for r in resultados if not r["ok"]]
    print(f"{len(resultados)} casos analisados")
    print(f"  ✓ sem problema:   {len(ok)}")
    print(f"  ✗ com problema:   {len(ruins)}")

    from collections import Counter
    motivos = Counter(
        p.split(":")[0] if ":" in p else p for r in ruins for p in r["problemas"]
    )
    print("\nMotivos:")
    for m, n in motivos.most_common():
        print(f"  {m:<32} {n}")
    print(f"\nDetalhe -> {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
