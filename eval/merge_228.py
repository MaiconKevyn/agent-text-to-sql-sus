"""Incorpora os casos válidos de `ground_truth_228.json` ao ground truth ativo.

Nada é importado às cegas. Cada caso passa por uma decisão explícita:

  MANTER     query correta como está
  CORRIGIR   pergunta boa, SQL com defeito conhecido -> SQL reescrito aqui
  RECUSAR    a base não tem o dado -> vira caso `irrespondivel` (sem gold_sql)
  DESCARTAR  pergunta não faz sentido nesta base e não dá para salvar

As correções sistemáticas são aplicadas por regra; as pontuais estão na tabela
`DECISOES`, cada uma com o motivo.

    python -m eval.merge_228            # gera eval/ground_truth_merged.yaml
    python -m eval.merge_228 --apply    # e substitui eval/ground_truth.yaml
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import Database  # noqa: E402

AQUI = Path(__file__).resolve().parent
SRC = AQUI / "ground_truth_228.json"
BASE = AQUI / "ground_truth.yaml"
OUT = AQUI / "ground_truth_merged.yaml"

# --------------------------------------------------------------------------
# 1. RECUSAR — a base não tem o dado. Viram casos de refusal, que são os mais
#    valiosos: é aqui que um chatbot ruim inventa número.
# --------------------------------------------------------------------------
RECUSAR: dict[str, str] = {
    # tabela `hospital` vazia: não há nome, natureza nem município do estabelecimento
    "GT005": "A tabela `hospital` está vazia; só existe o código CNES no fato.",
    "GT024": "Exige identificar hospitais; `hospital` está vazia.",
    "GT076": "'Municípios que atendem' exige o município do estabelecimento, que viria de `hospital` (vazia). A base só tem residência do paciente.",
    "GT086": "Exige nome e UF do hospital; `hospital` está vazia.",
    "GT089": "Exige identificar hospitais; `hospital` está vazia.",
    "GT091": "Exige identificar hospitais; `hospital` está vazia.",
    "GT132": "Exige nome e UF do hospital; `hospital` está vazia.",
    "GT161": "Exige a UF do hospital; `hospital` está vazia.",
    "GT185": "Exige identificar hospitais; `hospital` está vazia.",
    "GT186": "Exige identificar hospitais; `hospital` está vazia.",
    "GT209": "Exige identificar hospitais; `hospital` está vazia.",
    "GT214": "Exige identificar hospitais; `hospital` está vazia.",
    "GT221": "Exige a UF do hospital; `hospital` está vazia.",
    "GT228": "Compara UF de residência com UF do hospital; a segunda não existe.",
    "GT229": "Compara UF de residência com UF do hospital; a segunda não existe.",
    # tabela `socioeconomico` vazia: sem população, PIB, leitos, médicos
    "GT006": "A tabela `socioeconomico` está vazia.",
    "GT018": "Exige população; `socioeconomico` está vazia.",
    "GT040": "Exige mortalidade infantil; `socioeconomico` está vazia.",
    "GT163": "Exige população; `socioeconomico` está vazia.",
    "GT164": "Exige população; `socioeconomico` está vazia.",
    "GT165": "Exige PIB per capita; `socioeconomico` está vazia.",
    "GT189": "Exige médicos por mil habitantes; `socioeconomico` está vazia.",
    "GT190": "Exige mortalidade infantil; `socioeconomico` está vazia.",
    "GT222": "Exige população como denominador; `socioeconomico` está vazia.",
    "GT223": "Exige PIB per capita e população; `socioeconomico` está vazia.",
    "GT224": "Exige leitos SUS e população; `socioeconomico` está vazia.",
    # coluna corrompida
    "GT194": "GESTRISCO está TRUE em 99,6% das linhas, incluindo 58,8 milhões de pacientes masculinos.",
}

# --------------------------------------------------------------------------
# 2. CORRIGIR — pergunta boa, SQL com defeito. O SQL abaixo substitui o original.
# --------------------------------------------------------------------------
CORRIGIR: dict[str, tuple[str, str]] = {
    "GT043": (
        "DIAG_SECUN usa '0' como placeholder e nunca é NULL, então `IS NOT NULL` "
        "casava todas as 144.386.772 linhas.",
        "SELECT COUNT(*) AS com_ambos_diagnosticos\nFROM internacoes\nWHERE DIAG_SECUN <> '0';",
    ),
    "GT231": (
        "Testava `DIAG_SECUN IS NOT NULL AND <> ''`, mas o placeholder é a string "
        "'0' — o filtro casava tudo e o percentual dava 100% em todo ano.",
        "SELECT year(DT_SAIDA) AS ano,\n"
        "       CASE WHEN MORTE THEN 'obito' ELSE 'sem_obito' END AS desfecho,\n"
        "       COUNT(*) AS total_internacoes,\n"
        "       COUNT(*) FILTER (WHERE DIAG_SECUN <> '0') AS com_diag_secundario,\n"
        "       ROUND(100.0 * COUNT(*) FILTER (WHERE DIAG_SECUN <> '0') / COUNT(*), 2) AS percentual\n"
        "FROM internacoes\nGROUP BY 1, 2\nORDER BY 1, 2;",
    ),
    "GT167": (
        "CBOR usa '000000' como placeholder e nunca é NULL, então a query "
        "original respondia 144.386.772 em vez de 17.533.",
        "SELECT COUNT(*) AS internacoes_com_cbor\nFROM internacoes\nWHERE CBOR <> '000000';",
    ),
    "GT103": (
        "COUNT(DISTINCT SG_UF) sobre a dimensão devolve 39 por causa de 19 linhas-lixo "
        "com UF numérica. As UFs reais alcançáveis pelo fato são 27.",
        "SELECT COUNT(DISTINCT m.SG_UF) AS total_estados\n"
        "FROM internacoes i\nJOIN municipios m ON i.MUNIC_RES = m.CO_MUNICIPIO_6D;",
    ),
    "GT125": (
        "INNER JOIN com a dimensão `tempo` descarta silenciosamente as 431.437 "
        "internações de 2007, porque `tempo` começa em 2008.",
        "SELECT dayofweek(DT_SAIDA) AS dia_semana,\n"
        "       COUNT(*) AS internacoes_uti,\n"
        "       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percentual\n"
        "FROM internacoes\nWHERE MARCA_UTI > 0\nGROUP BY 1\nORDER BY 1;",
    ),
    # As 12 que usavam `internacao_procedimento` (tabela inexistente). O
    # procedimento está em internacoes.PROC_REA, uma coluna do próprio fato.
    "GT021": (
        "Tabela `internacao_procedimento` não existe; o procedimento é a coluna "
        "internacoes.PROC_REA.",
        "SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total\n"
        "FROM internacoes i\nJOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "GROUP BY 1\nORDER BY total DESC\nLIMIT 5;",
    ),
    "GT068": (
        "Tabela `internacao_procedimento` não existe; usar internacoes.PROC_REA.",
        "SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total\n"
        "FROM internacoes i\nJOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "GROUP BY 1\nORDER BY total DESC\nLIMIT 10;",
    ),
    "GT079": (
        "Tabela inexistente e `hospital` vazia; o recorte geográfico possível é "
        "por município de RESIDÊNCIA.",
        "SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total\n"
        "FROM internacoes i\nJOIN municipios m ON i.MUNIC_RES = m.CO_MUNICIPIO_6D\n"
        "JOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "WHERE m.SG_UF = 'RS'\nGROUP BY 1\nORDER BY total DESC\nLIMIT 10;",
    ),
    "GT081": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT sexo, procedimento, total FROM (\n"
        "  SELECT s.DESCRICAO AS sexo, p.NOME_PROC AS procedimento, COUNT(*) AS total,\n"
        "         ROW_NUMBER() OVER (PARTITION BY s.DESCRICAO ORDER BY COUNT(*) DESC) rn\n"
        "  FROM internacoes i\n  JOIN sexo s ON i.SEXO = s.SEXO\n"
        "  JOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n  GROUP BY 1, 2\n)\n"
        "WHERE rn <= 5\nORDER BY sexo, total DESC;",
    ),
    "GT084": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total\n"
        "FROM internacoes i\nJOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "WHERE i.MORTE\nGROUP BY 1\nORDER BY total DESC\nLIMIT 3;",
    ),
    "GT131": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total\n"
        "FROM internacoes i\nJOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "WHERE i.RACA_COR = '05'\nGROUP BY 1\nORDER BY total DESC\nLIMIT 5;",
    ),
    "GT166": (
        "Tabela inexistente. A pergunta equivalente no fato é quantas internações "
        "não casam com a dimensão de procedimentos.",
        "SELECT COUNT(*) AS sem_procedimento_correspondente\n"
        "FROM internacoes i\nLEFT JOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "WHERE p.PROC_REA IS NULL;",
    ),
    "GT199": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total\n"
        "FROM internacoes i\nJOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "WHERE i.MARCA_UTI > 0\nGROUP BY 1\nORDER BY total DESC\nLIMIT 10;",
    ),
    "GT210": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT capitulo, procedimento, total FROM (\n"
        "  SELECT c.DS_CAPITULO AS capitulo, p.NOME_PROC AS procedimento, COUNT(*) AS total,\n"
        "         ROW_NUMBER() OVER (PARTITION BY c.DS_CAPITULO ORDER BY COUNT(*) DESC) rn\n"
        "  FROM internacoes i\n  JOIN cid c ON i.DIAG_PRINC = c.CID\n"
        "  JOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n  GROUP BY 1, 2\n)\n"
        "WHERE rn = 1\nORDER BY total DESC;",
    ),
    "GT122": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT procedimento, total, pct_acumulado FROM (\n"
        "  SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total,\n"
        "         ROUND(100.0 * SUM(COUNT(*)) OVER (ORDER BY COUNT(*) DESC)\n"
        "               / SUM(COUNT(*)) OVER (), 2) AS pct_acumulado\n"
        "  FROM internacoes i\n  JOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "  GROUP BY 1\n)\nWHERE pct_acumulado <= 80\nORDER BY total DESC;",
    ),
    "GT226": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT procedimento, total, pct_acumulado FROM (\n"
        "  SELECT p.NOME_PROC AS procedimento, COUNT(*) AS total,\n"
        "         ROUND(100.0 * SUM(COUNT(*)) OVER (ORDER BY COUNT(*) DESC)\n"
        "               / SUM(COUNT(*)) OVER (), 2) AS pct_acumulado\n"
        "  FROM internacoes i\n  JOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n"
        "  WHERE i.MARCA_UTI > 0\n  GROUP BY 1\n)\nWHERE pct_acumulado <= 80\nORDER BY total DESC;",
    ),
    "GT227": (
        "Tabela inexistente; usar internacoes.PROC_REA.",
        "SELECT sexo, faixa_etaria, procedimento, total FROM (\n"
        "  SELECT s.DESCRICAO AS sexo,\n"
        "         CASE WHEN i.IDADE < 18 THEN '<18' WHEN i.IDADE < 60 THEN '18-59'\n"
        "              ELSE '60+' END AS faixa_etaria,\n"
        "         p.NOME_PROC AS procedimento, COUNT(*) AS total,\n"
        "         ROW_NUMBER() OVER (PARTITION BY s.DESCRICAO,\n"
        "           CASE WHEN i.IDADE < 18 THEN '<18' WHEN i.IDADE < 60 THEN '18-59'\n"
        "                ELSE '60+' END ORDER BY COUNT(*) DESC) rn\n"
        "  FROM internacoes i\n  JOIN sexo s ON i.SEXO = s.SEXO\n"
        "  JOIN procedimentos p ON i.PROC_REA = p.PROC_REA\n  GROUP BY 1, 2, 3\n)\n"
        "WHERE rn <= 3\nORDER BY sexo, faixa_etaria, total DESC;",
    ),
}

# --------------------------------------------------------------------------
# 3. REESCREVER A PERGUNTA — o SQL está certo, o enunciado é que engana.
# --------------------------------------------------------------------------
REESCREVER_PERGUNTA: dict[str, tuple[str, str]] = {
    "GT008": (
        "IND_VDRL marca que o exame foi registrado, não que deu positivo.",
        "Em quantas internações há registro de exame VDRL?",
    ),
    "GT025": (
        "IND_VDRL marca registro do exame, não resultado positivo.",
        "Quantas internações com registro de exame VDRL resultaram em óbito?",
    ),
    "GT195": (
        "IND_VDRL marca registro do exame, não resultado positivo.",
        "Qual a evolução anual das internações com registro de exame VDRL?",
    ),
    "GT011": (
        "O campo é 99,99% 'não informado'; a pergunta precisa deixar claro que "
        "se trata de contagem de preenchimento.",
        "Quantas internações têm vínculo previdenciário efetivamente informado?",
    ),
}

# --------------------------------------------------------------------------
# 4. DESCARTAR — nem a pergunta nem o SQL se salvam.
# --------------------------------------------------------------------------
DESCARTAR: dict[str, str] = {
    "GT046": "Duplicata de GT066 ('total de internações por ano').",
    "GT056": "Duplicata de GT036/GT036 no formato 'quantas internações em <ano>'.",
    "GT148": "Duplicata de GT007 ('internações com custo de UTI > 0').",
    "GT052": "Duplicata de GT004 ('quantos CIDs existem').",
    "GT168": "Duplicata de `demo_por_sexo`, que já existe na base e é um caso de armadilha.",
    # Redundantes com casos que já existem na base — mesmo resultado, e a versão
    # original testa mais (armadilha declarada, ressalva obrigatória na resposta).
    "GT001": "Mesmo resultado de `agg_total_internacoes`.",
    "GT002": "Mesmo resultado de `agg_total_obitos`.",
    "GT108": "Mesmo resultado de `demo_raca_cor`, que ainda exige a ressalva de 29,2% sem informação.",
    "GT109": "Mesmo resultado de `demo_menores_1_ano`.",
    "GT069": "Mesmo resultado de `cid_top10_diagnosticos`.",
    "GT139": "Mesmo resultado de `cid_categoria_j18_completa`, que é o caso de armadilha do CID sem ponto.",
    "GT021": "Mesmo resultado de `proc_top5`.",
    "GT169": "Mesmo resultado de `carint_urgencia_vs_eletivo`.",
}

# A troca DT_INTER -> DT_SAIDA vale para recorte de período. NÃO vale quando a
# pergunta é sobre a data de entrada em si, nem quando DT_INTER entra num
# cálculo de duração ou de idade.
MANTER_DT_INTER: dict[str, str] = {
    "GT160": "A pergunta é literalmente sobre a data de ENTRADA fora do período.",
    "GT230": "DT_INTER entra no cálculo de dias-calendário de permanência.",
    "GT232": "DT_INTER entra na checagem de consistência da idade contra NASC.",
    # Sazonalidade: "em que mês/estação/dia da semana isso aconteceu" pergunta
    # sobre o INÍCIO da internação. Usar a data de saída deslocaria tudo pela
    # permanência média (5 dias). Como o dicionário manda usar DT_SAIDA por
    # padrão, o enunciado passa a dizer explicitamente qual data usar — assim a
    # pergunta fica sem ambiguidade em vez de depender de convenção implícita.
    "GT042": "sazonalidade", "GT047": "sazonalidade", "GT105": "sazonalidade",
    "GT120": "sazonalidade", "GT133": "sazonalidade", "GT154": "sazonalidade",
    "GT155": "sazonalidade", "GT180": "sazonalidade", "GT203": "sazonalidade",
    "GT220": "sazonalidade",
}

# Sufixo acrescentado ao enunciado dos casos de sazonalidade.
SUFIXO_SAZONAL = " Considere a data de internação (entrada)."

# Casos cujo resultado VAZIO é a resposta certa. Sem isto o merge os descarta
# como se a query tivesse falhado.
VAZIO_ESPERADO: dict[str, str] = {
    "GT233": "A cobertura de MUNIC_RES é 100%: não existe município órfão. "
             "O chatbot precisa relatar 'nenhum' em vez de inventar linhas.",
}

# Regra sistemática: a base é delimitada por DT_SAIDA. DT_INTER sofre censura
# nas duas pontas — cria anos 1995-2006 com 1 a 4 registros (restos de
# internações longas) e perde 101 mil altas de 2023 que só saíram em 2024.
SUBSTITUIR_DATA = True

CAT_POR_PADRAO = [
    (r"irrespond", "irrespondivel"),
    (r"ROW_NUMBER|NTILE|QUANTILE|OVER\s*\(|WITH\s", "agregacao_complexa"),
    (r"taxa|percentual|pct|ROUND\s*\(\s*100", "taxa"),
    (r"year\(|EXTRACT\s*\(\s*(YEAR|MONTH|QUARTER|DOW)", "temporal"),
    (r"\bJOIN\b", "join_dimensao"),
    (r"\bWHERE\b", "filtro"),
    (r"COUNT|SUM|AVG|MIN|MAX|MEDIAN", "agregacao_simples"),
]

DIFICULDADE = {"easy": "facil", "medium": "media", "hard": "dificil"}


def categoria(sql: str, question: str) -> str:
    alvo = f"{sql} {question}"
    for pat, cat in CAT_POR_PADRAO:
        if re.search(pat, alvo, re.I):
            return cat
    return "agregacao_simples"


def normaliza_data(sql: str) -> tuple[str, bool]:
    """Troca DT_INTER por DT_SAIDA e EXTRACT(...) pelas funções nativas."""
    novo = re.sub(r'"?DT_INTER"?', "DT_SAIDA", sql)
    novo = re.sub(r"EXTRACT\s*\(\s*YEAR\s+FROM\s+([^)]+)\)", r"year(\1)", novo, flags=re.I)
    novo = re.sub(r"EXTRACT\s*\(\s*MONTH\s+FROM\s+([^)]+)\)", r"month(\1)", novo, flags=re.I)
    novo = re.sub(r"EXTRACT\s*\(\s*QUARTER\s+FROM\s+([^)]+)\)", r"quarter(\1)", novo, flags=re.I)
    novo = re.sub(r"EXTRACT\s*\(\s*DOW\s+FROM\s+([^)]+)\)", r"dayofweek(\1)", novo, flags=re.I)
    return novo, novo != sql


def precisa_ordem(question: str, sql: str) -> bool:
    """Ordem só é exigida quando a pergunta pede ranking ou série."""
    if re.search(r"\bLIMIT\s+\d+", sql, re.I) and re.search(r"\bORDER\s+BY", sql, re.I):
        return True
    return bool(
        re.search(r"\b(top|maior(es)?|menor(es)?|mais|principa|ranking|evolu|cresc|queda)\b",
                  question, re.I)
    )


def main() -> int:
    aplicar = "--apply" in sys.argv
    casos = json.loads(SRC.read_text(encoding="utf-8"))
    base = yaml.safe_load(BASE.read_text(encoding="utf-8"))
    ids_base = {c["id"] for c in base["cases"]}

    db = Database()
    novos, relatorio = [], []

    for c in casos:
        gid = c["id"]
        pergunta = c["question"]
        sql = c["query"]
        acao, motivo = "MANTER", ""

        if gid in DESCARTAR:
            relatorio.append((gid, "DESCARTAR", DESCARTAR[gid]))
            continue

        if gid in RECUSAR:
            novos.append({
                "id": f"gt_{gid.lower()}",
                "question": pergunta,
                "category": "irrespondivel",
                "difficulty": DIFICULDADE.get(c.get("difficulty"), "media"),
                "answerable": False,
                "tests": RECUSAR[gid],
                "origem": gid,
            })
            relatorio.append((gid, "RECUSAR", RECUSAR[gid]))
            continue

        if gid in CORRIGIR:
            motivo, sql = CORRIGIR[gid]
            acao = "CORRIGIR"
        if gid in REESCREVER_PERGUNTA:
            m2, pergunta = REESCREVER_PERGUNTA[gid]
            motivo = f"{motivo} {m2}".strip()
            acao = "CORRIGIR" if acao == "CORRIGIR" else "REESCREVER"

        if gid not in MANTER_DT_INTER:
            sql2, mudou = normaliza_data(sql)
            if mudou:
                sql = sql2
                motivo = (motivo + " DT_INTER -> DT_SAIDA (convenção da base).").strip()
                acao = "CORRIGIR" if acao != "REESCREVER" else acao
        elif MANTER_DT_INTER[gid] == "sazonalidade":
            pergunta = pergunta.rstrip("?. ") + "?" + SUFIXO_SAZONAL
            motivo = (motivo + " Sazonalidade: enunciado explicita a data de entrada.").strip()
            acao = "REESCREVER"

        try:
            res = db.run(sql, validate=False, add_limit=False)
        except Exception as exc:  # noqa: BLE001
            relatorio.append((gid, "FALHOU", f"{type(exc).__name__}: {exc}"))
            continue
        if not res.rows and gid not in VAZIO_ESPERADO:
            relatorio.append((gid, "FALHOU", "resultado vazio após correção"))
            continue

        entrada = {
            "id": f"gt_{gid.lower()}",
            "question": pergunta,
            "category": categoria(sql, pergunta),
            "difficulty": DIFICULDADE.get(c.get("difficulty"), "media"),
            "ordered": precisa_ordem(pergunta, sql),
            "tests": (motivo or c.get("notes") or "Importado do conjunto de 228 casos.")[:400],
            "gold_sql": sql.strip().rstrip(";") + ";",
            "origem": gid,
        }
        if gid in VAZIO_ESPERADO:
            entrada["expect_empty"] = True
            entrada["tests"] = VAZIO_ESPERADO[gid]
        novos.append(entrada)
        relatorio.append((gid, acao, motivo or "sem alteração"))

    # Remove `ordered: false` para não poluir o YAML.
    for n in novos:
        if n.get("ordered") is False:
            n.pop("ordered")

    fundido = {"cases": base["cases"] + novos}
    OUT.write_text(
        yaml.safe_dump(fundido, allow_unicode=True, sort_keys=False, width=100),
        encoding="utf-8",
    )

    from collections import Counter
    print(f"Base original:        {len(base['cases'])} casos")
    print(f"Importados dos 228:   {len(novos)}")
    print(f"Total fundido:        {len(fundido['cases'])}")
    print("\nAções:", dict(Counter(a for _, a, _ in relatorio)))
    falhas = [r for r in relatorio if r[1] == "FALHOU"]
    if falhas:
        print(f"\nNão importados por falha ({len(falhas)}):")
        for gid, _, m in falhas:
            print(f"  {gid}: {m[:110]}")
    print(f"\n-> {OUT.name}")

    if aplicar:
        BASE.write_text(OUT.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"-> aplicado em {BASE.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
