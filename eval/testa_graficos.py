"""Testes end-to-end da geração de gráfico, contra a API rodando.

Cada caso verifica três coisas distintas: que o agente escolheu a FORMA certa,
que `x`/`y` apontam para colunas que o resultado realmente tem, e que a resposta
em texto não tentou escrever código de plotagem — a interface é que desenha.
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import sys
import urllib.parse
import urllib.request

API = "http://localhost:8000/api/ask"

# (pergunta, formas aceitáveis) — mais de uma quando a escolha é defensável.
CASOS: list[tuple[str, set[str]]] = [
    ("Faça um gráfico da evolução de internações por ano", {"linha"}),
    ("Gráfico dos 10 municípios com mais internações", {"barra_horizontal", "barra"}),
    ("Gráfico de pizza com a proporção de internações por sexo", {"pizza"}),
    (
        "Mostre num gráfico a evolução de internações por sexo entre 2018 e 2022",
        {"linha", "barra"},
    ),
    ("Faça um gráfico de internações por UF", {"barra", "barra_horizontal"}),
    ("Gráfico da distribuição de internações por mês e ano desde 2015", {"heatmap", "linha"}),
    # Controle: pergunta escalar. Um gráfico de um número só não existe.
    ("Quantas internações existem no total?", {"nenhum"}),
]

CODIGO = ("matplotlib", "import ", "plt.", "```", "df.plot", "chart.js", "seguem os dados para")


def pergunta(q: str) -> dict:
    url = f"{API}?{urllib.parse.urlencode({'q': q})}"
    saida: dict = {"q": q, "chart": None, "columns": [], "nRows": 0, "texto": "", "descarte": ""}
    with urllib.request.urlopen(url, timeout=300) as resp:
        for linha_bruta in resp:
            linha = linha_bruta.decode("utf-8").strip()
            if not linha.startswith("data:"):
                continue
            ev = json.loads(linha[5:])
            tipo = ev["type"]
            if tipo == "chart":
                saida["chart"] = ev["chart"]
            elif tipo == "result":
                saida["columns"] = ev["result"]["columns"]
                saida["nRows"] = ev["result"]["nRows"]
            elif tipo == "token":
                saida["texto"] += ev["text"]
            elif tipo == "trace" and ev["entry"]["title"] == "Gráfico descartado":
                saida["descarte"] = ev["entry"]["body"]
            elif tipo == "failure":
                saida["falha"] = ev["message"]
    return saida


def main() -> int:
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        futuros = {pool.submit(pergunta, q): (q, ok) for q, ok in CASOS}
        resultados = []
        for fut in cf.as_completed(futuros):
            q, aceitas = futuros[fut]
            try:
                resultados.append((q, aceitas, fut.result()))
            except Exception as exc:  # noqa: BLE001
                resultados.append((q, aceitas, {"q": q, "falha": str(exc)}))

    resultados.sort(key=lambda r: [c[0] for c in CASOS].index(r[0]))
    passou = 0
    for q, aceitas, r in resultados:
        problemas = []
        if "falha" in r:
            problemas.append(f"pipeline falhou: {r['falha']}")
        spec = r.get("chart")
        forma = spec["kind"] if spec else "nenhum"
        if forma not in aceitas:
            problemas.append(f"forma {forma!r}, esperava uma de {sorted(aceitas)}")
        if spec:
            for eixo in ("x", "y"):
                if spec[eixo] not in r["columns"]:
                    problemas.append(f"{eixo}={spec[eixo]!r} não está em {r['columns']}")
            if spec["series"] and spec["series"] not in r["columns"]:
                problemas.append(f"series={spec['series']!r} não está em {r['columns']}")
        # O modelo já tentou apelidar as colunas de "x"/"y"/"series", tomando os
        # nomes dos campos do spec como nomes de coluna. A tabela é vista pelo
        # usuário: uma coluna chamada "x" não diz nada.
        if genericas := [c for c in r.get("columns", []) if c.lower() in {"x", "y", "series"}]:
            problemas.append(f"colunas com nome genérico no SELECT: {genericas}")

        baixo = r.get("texto", "").lower()
        if achou := [m for m in CODIGO if m in baixo]:
            problemas.append(f"a resposta tentou escrever código/plotagem: {achou}")

        marca = "OK  " if not problemas else "FALHA"
        if not problemas:
            passou += 1
        print(f"\n{marca} {q}")
        print(f"      forma={forma}  colunas={r.get('columns')}  linhas={r.get('nRows')}")
        if spec:
            print(f"      x={spec['x']} y={spec['y']} series={spec['series']}")
            print(f"      motivo: {spec['reason'][:110]}")
        elif r.get("descarte"):
            print(f"      descartado: {r['descarte'][:110]}")
        for p in problemas:
            print(f"      ⚠ {p}")

    print(f"\n{passou}/{len(CASOS)} casos passaram")
    return 0 if passou == len(CASOS) else 1


if __name__ == "__main__":
    sys.exit(main())
