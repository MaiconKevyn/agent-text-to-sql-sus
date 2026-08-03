"""Extrai dados reais do SIH/SUS para os casos de gráfico do lab.

Cada caso existe porque um usuário faz de fato essa pergunta e porque a FORMA
do resultado estressa uma coisa diferente na biblioteca de gráfico: muitas
categorias, distribuição, matriz, muitas séries, correlação, composição.

O SQL segue as regras do dicionário: SEXO só tem 1 e 3 no fato, SP e TO estão
ausentes, DT_SAIDA define o período e 2007 é parcial.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.db import Database  # noqa: E402

REGIAO = """
  CASE
    WHEN m.SG_UF IN ('AC','AP','AM','PA','RO','RR','TO') THEN 'Norte'
    WHEN m.SG_UF IN ('AL','BA','CE','MA','PB','PE','PI','RN','SE') THEN 'Nordeste'
    WHEN m.SG_UF IN ('DF','GO','MT','MS') THEN 'Centro-Oeste'
    WHEN m.SG_UF IN ('ES','MG','RJ','SP') THEN 'Sudeste'
    ELSE 'Sul'
  END
"""

CASOS: dict[str, tuple[str, str]] = {
    # Alta cardinalidade: 25 barras. Onde os rótulos começam a colidir.
    "internacoes_por_uf": (
        "Internações por UF",
        """
        SELECT m.SG_UF AS uf, COUNT(*) AS internacoes
        FROM internacoes i
        JOIN municipios m ON i.MUNIC_RES = m.CO_MUNICIPIO_6D
        GROUP BY 1
        ORDER BY 2 DESC
        """,
    ),
    # Distribuição: 21 faixas de 5 anos. Barras contíguas, sem espaço entre elas.
    "distribuicao_idade": (
        "Distribuição de idade dos pacientes",
        """
        SELECT (IDADE // 5) * 5 AS faixa_inicio, COUNT(*) AS internacoes
        FROM internacoes
        WHERE IDADE BETWEEN 0 AND 99
        GROUP BY 1
        ORDER BY 1
        """,
    ),
    # Matriz 16x12 = 192 células. Recharts não tem heatmap; ECharts tem.
    "sazonalidade_mes_ano": (
        "Sazonalidade: internações por mês e ano",
        """
        SELECT year(DT_SAIDA) AS ano, month(DT_SAIDA) AS mes, COUNT(*) AS internacoes
        FROM internacoes
        WHERE year(DT_SAIDA) BETWEEN 2008 AND 2023
        GROUP BY 1, 2
        ORDER BY 1, 2
        """,
    ),
    # Cinco séries no tempo: testa o limite da paleta categórica e a legenda.
    "evolucao_por_regiao": (
        "Evolução de internações por região",
        f"""
        SELECT year(i.DT_SAIDA) AS ano, {REGIAO} AS regiao, COUNT(*) AS internacoes
        FROM internacoes i
        JOIN municipios m ON i.MUNIC_RES = m.CO_MUNICIPIO_6D
        WHERE year(i.DT_SAIDA) BETWEEN 2008 AND 2023
        GROUP BY 1, 2
        ORDER BY 1, 2
        """,
    ),
    # Correlação: duas medidas contínuas + rótulo. Dispersão, não barra.
    "custo_x_permanencia_uf": (
        "Custo médio × permanência média por UF",
        """
        SELECT m.SG_UF AS uf,
               ROUND(AVG(i.DIAS_PERM), 2) AS permanencia_media,
               ROUND(AVG(i.VAL_TOT), 2) AS custo_medio,
               COUNT(*) AS internacoes
        FROM internacoes i
        JOIN municipios m ON i.MUNIC_RES = m.CO_MUNICIPIO_6D
        GROUP BY 1
        ORDER BY 3 DESC
        """,
    ),
    # Composição ao longo do tempo: empilhada 100%, não valores absolutos.
    "carater_por_ano": (
        "Caráter da internação ao longo do tempo",
        """
        SELECT year(DT_SAIDA) AS ano,
               CASE CAR_INT
                 WHEN 1 THEN 'Eletivo'
                 WHEN 2 THEN 'Urgência'
                 ELSE 'Acidente/outros'
               END AS carater,
               COUNT(*) AS internacoes
        FROM internacoes
        WHERE year(DT_SAIDA) BETWEEN 2008 AND 2023
        GROUP BY 1, 2
        ORDER BY 1, 2
        """,
    ),
}


def main() -> None:
    destino = Path(__file__).resolve().parents[1] / "frontend/src/lab/dados.json"
    saida = json.loads(destino.read_text())
    db = Database()

    for chave, (titulo, sql) in CASOS.items():
        print(f"→ {chave} … ", end="", flush=True)
        res = db.run(sql.strip(), add_limit=False)
        saida[chave] = {
            "titulo": titulo,
            "sql": sql.strip(),
            "columns": list(res.columns),
            "rows": [[_puro(v) for v in linha] for linha in res.rows],
            "nRows": len(res.rows),
        }
        print(f"{len(res.rows)} linhas")

    destino.write_text(json.dumps(saida, ensure_ascii=False, indent=1))
    print(f"\ngravado em {destino}")


def _puro(v: object) -> object:
    """DuckDB devolve Decimal/date; JSON não serializa nenhum dos dois."""
    if isinstance(v, (int, float, str)) or v is None:
        return v
    try:
        f = float(v)  # type: ignore[arg-type]
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return str(v)


if __name__ == "__main__":
    main()
