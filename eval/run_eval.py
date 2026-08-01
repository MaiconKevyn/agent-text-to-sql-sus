"""Avaliação por EXECUTION ACCURACY.

Comparar o texto do SQL não serve: a mesma pergunta admite muitas queries
corretas e sintaticamente distintas. Comparamos o RESULTADO da execução.

Critério de acerto (casos respondíveis):
  - mesmo número de colunas e de linhas;
  - mesmos valores, com float arredondado (tolerância de arredondamento);
  - ordem das linhas só é exigida quando o caso é marcado `ordered: true`;
  - permutação de colunas é tolerada (até 5 colunas) — devolver
    (uf, total) ou (total, uf) é igualmente correto.

Critério de acerto (casos irrespondíveis):
  - o agente precisa marcar answerable=false. Responder com números inventados
    conta como erro grave.

Uso:
    python -m eval.run_eval                 # todos os casos
    python -m eval.run_eval --limit 10      # amostra rápida
    python -m eval.run_eval --category armadilha
    python -m eval.run_eval --ids demo_mulheres_2019,cid_pneumonia_categoria
    python -m eval.run_eval --recusa exclui  # sem os irrespondíveis, ~10% mais barato

`--recusa exclui` serve para ITERAR na geração de SQL sem pagar pelos 35 casos
de recusa. Não use na execução que vai virar a medição registrada: a recusa é a
única métrica que pega o agente respondendo uma pergunta VIZINHA em vez de
recusar — o erro que não parece erro, porque o número sai com cara de certo.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shlex
import sys
import time
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.agent import TextToSQLAgent  # noqa: E402
from src.config import settings  # noqa: E402
from src.db import Database  # noqa: E402

# Importado pelo pacote e não por caminho relativo: assim `python -m
# eval.run_eval` e `python eval/run_eval.py` funcionam os dois.
from eval import resultados  # noqa: E402

# Tolerância numérica. Dois efeitos distintos precisam ser absorvidos, e nenhum
# deles é erro de SQL:
#
# 1. Ruído de soma paralela: somar 144 milhões de doubles em ordens de thread
#    diferentes devolve 212580836278.02 numa execução e ...278.07 na seguinte,
#    para a MESMA query. Tratado por tolerância relativa.
# 2. Precisão de apresentação: o gold escreve ROUND(AVG(x), 4) = 5,0631 e o
#    modelo escreve ROUND(AVG(x), 2) = 5,06. Tratado comparando na precisão
#    MAIS GROSSA das duas — "concordam até onde ambos se comprometem".
#
# O que continua sendo reprovado: 5,06 contra 5,07 (ambos se comprometem com 2
# casas e discordam nelas).
REL_TOL = 1e-9
ABS_TOL = 1e-9


def _decimais(v: float) -> int:
    """Casas decimais efetivamente presentes no valor, até 6."""
    s = f"{v:.6f}".rstrip("0")
    return len(s.split(".")[1]) if "." in s else 0


def _arredonda(v: float, casas: int) -> Decimal:
    """Arredonda como o DuckDB: metade para longe do zero.

    O `round()` do Python usa banker's rounding — round(5.125, 2) devolve 5.12
    enquanto o DuckDB devolve 5.13. Numa coluna de 131 médias, esse único valor
    divergente reprovava o caso inteiro.
    """
    return Decimal(repr(v)).quantize(Decimal(1).scaleb(-casas), rounding=ROUND_HALF_UP)


def _numeros_equivalentes(a: float, b: float) -> bool:
    if math.isclose(a, b, rel_tol=REL_TOL, abs_tol=ABS_TOL):
        return True
    # A regra de precisão só vale quando ambos os lados publicam ao menos uma
    # casa decimal. Sem isso, 0,0004 e 0,0 "concordariam" arredondando a zero
    # casas — exatamente o falso positivo que mascarava a coluna UTI_INT_TO.
    casas = min(_decimais(a), _decimais(b))
    if casas < 1:
        return False
    # Tolera 1 unidade na última casa publicada: o gold arredonda uma vez e a
    # predição arredonda de novo sobre um valor já arredondado.
    return abs(_arredonda(a, casas) - _arredonda(b, casas)) <= Decimal(1).scaleb(-casas)


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def norm_cell(v):
    """Normaliza um valor preservando o tipo (número continua número)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return " ".join(_strip_accents(str(v)).lower().split())


def _rotulos_parecidos(a: str, b: str) -> bool:
    """Rótulos que nomeiam o mesmo grupo escrito de outro jeito.

    Só é usado no modo frouxo, e mesmo lá o alinhamento das linhas continua
    exigido — então 'Parda'/'Branca' nunca passa, mas '<1 ano' e
    'menor de 1 ano' passam.
    """
    # Faixas e intervalos: os números do rótulo é que definem o grupo.
    # '<1 ano' e 'menor de 1 ano' -> [1]; '1 a 14' e '1-14 anos' -> [1, 14].
    na, nb = re.findall(r"\d+", a), re.findall(r"\d+", b)
    if na and na == nb:
        return True
    ta, tb = set(a.split()), set(b.split())
    if ta and tb and len(ta & tb) / len(ta | tb) >= 0.5:
        return True
    return len(a) >= 4 and len(b) >= 4 and a[:4] == b[:4]


def _como_numero(v):
    """Devolve o valor numérico, aceitando número escrito como texto.

    O mesmo dado aparece como '03' (RACA_COR é VARCHAR) e como 3, ou como
    '2021' e 2021, conforme o CAST que a query fez. São o mesmo valor.
    """
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", ".")
        if re.fullmatch(r"[+-]?\d+(\.\d+)?", s):
            return float(s)
    return None


def cells_equal(a, b, loose: bool = False) -> bool:
    a, b = norm_cell(a), norm_cell(b)
    if a is None or b is None:
        return a is b

    na, nb = _como_numero(a), _como_numero(b)
    if na is not None and nb is not None:
        return _numeros_equivalentes(na, nb)
    # Um lado numérico e o outro texto não-numérico: são coisas diferentes.
    a_num = isinstance(a, (int, float)) and not isinstance(a, bool)
    b_num = isinstance(b, (int, float)) and not isinstance(b, bool)
    if a_num != b_num:
        return False

    if isinstance(a, str) and isinstance(b, str):
        # Rótulos de grupo são apresentação: '1 a 14' e '1 a 14 anos' nomeiam o
        # mesmo grupo, e a igualdade das contagens é que prova isso.
        if a == b or a.startswith(b) or b.startswith(a):
            return True
        return loose and _rotulos_parecidos(a, b)
    return a == b


# Rótulos que marcam ausência de informação. Aparecem como categoria própria em
# várias dimensões (`sexo`, `raca_cor`, `instrucao`, `especialidade`,
# `complexidade`, `car_int`) e como bucket de LEFT JOIN sem correspondência.
# Incluir ou não essa linha é escolha de apresentação, não de correção: as duas
# respostas contêm o mesmo conteúdo informativo. O avaliador descarta essas
# linhas dos DOIS lados antes de comparar.
_MARCADORES_SEM_INFO = (
    "nao informad", "nao informacao", "sem informac", "sem informad",
    "ignorad", "nao document", "nao mapead", "nao cadastrad", "nao declarad",
    "desconhecid", "sem correspond", "nao encontrad", "sem mapeamento",
    "sem capitulo", "nao especificad", "nao identificad", "sem categoria",
    "outro/sem", "indefinid", "(vazio)", "n/a", "n/d",
)


def _e_sem_informacao(v) -> bool:
    n = norm_cell(v)
    if not isinstance(n, str) or not n:
        return False
    limpo = n.strip("()[]'\" ")
    return any(m in limpo for m in _MARCADORES_SEM_INFO)


def descarta_sem_informacao(rows: list[tuple]) -> list[tuple]:
    """Remove as linhas cujo rótulo é 'não informado' e equivalentes."""
    return [r for r in rows if not any(_e_sem_informacao(v) for v in r)]


def _col(rows: list[tuple], i: int) -> list:
    return [r[i] for r in rows]


def _cols_equal(gcol: list, pcol: list, loose: bool = False) -> bool:
    return len(gcol) == len(pcol) and all(
        cells_equal(a, b, loose) for a, b in zip(gcol, pcol)
    )


def _is_num(v) -> bool:
    v = norm_cell(v)
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _chave_ordem(v):
    """Chave de ordenação que respeita a natureza do valor.

    Ordenar número pela representação em string desalinha as linhas: o gold traz
    7.744184270181821 e a predição 7.74, e como texto eles caem em posições
    diferentes do que cairiam como número. Números ordenam por valor; o resto,
    por texto.
    """
    n = norm_cell(v)
    if n is None:
        return (2, 0.0, "")
    if isinstance(n, bool):
        return (1, 0.0, str(n))
    if isinstance(n, (int, float)):
        return (0, float(n), "")
    return (1, 0.0, str(n))


def _ordena(vals: list) -> list:
    return sorted(vals, key=_chave_ordem)


def _multiconjuntos_iguais(a: list, b: list, loose: bool = False) -> bool:
    """Compara dois multiconjuntos com a mesma tolerância dos valores."""
    if len(a) != len(b):
        return False
    return all(cells_equal(x, y, loose) for x, y in zip(_ordena(a), _ordena(b)))


def _atribuicoes(cand: list[list[int]]):
    """Enumera atribuições injetivas coluna-do-gold -> coluna-da-predição."""
    def rec(i: int, usadas: set[int], atual: list[int]):
        if i == len(cand):
            yield list(atual)
            return
        for pj in cand[i]:
            if pj in usadas:
                continue
            atual.append(pj)
            usadas.add(pj)
            yield from rec(i + 1, usadas, atual)
            usadas.discard(pj)
            atual.pop()

    yield from rec(0, set(), [])


def results_match(gold_rows, pred_rows, ordered: bool) -> tuple[bool, str]:
    """Devolve (acertou, modo).

    Critério: `gold ⊆ pred`. Toda coluna do gold precisa achar uma coluna
    DISTINTA na predição com os mesmos valores, E as linhas precisam se
    corresponder. Colunas extras na predição são permitidas — devolver o código
    da raça E o rótulo E o percentual é mais informativo, não menos correto.

    Sem `ordered`, NÃO se supõe uma ordem canônica de linhas: ordenar depende de
    quais colunas existem, então gold ordenado por rótulo e predição ordenada
    por código jamais alinhariam. O casamento é feito por multiconjunto de
    valores por coluna e depois validado no nível da linha.

    Modos: "exato" (mesma forma), "superset" (predição com colunas a mais),
    "numerico" (só as colunas numéricas casaram — rótulos divergiram).
    """
    # Linhas de "não informado" entram ou não conforme quem escreveu a query
    # usou INNER ou LEFT JOIN. Como o conteúdo da resposta é o mesmo, saem dos
    # dois lados antes de qualquer comparação — inclusive antes da contagem de
    # linhas, que é onde essa divergência costumava reprovar o caso.
    sem_info = len(gold_rows) != len(pred_rows) or any(
        any(_e_sem_informacao(v) for v in r) for r in gold_rows
    )
    if sem_info:
        gold_rows = descarta_sem_informacao(gold_rows)
        pred_rows = descarta_sem_informacao(pred_rows)

    if len(gold_rows) != len(pred_rows):
        return False, f"linhas {len(gold_rows)}≠{len(pred_rows)}"
    if not gold_rows:
        return True, "exato"

    g, p = list(gold_rows), list(pred_rows)
    ng, np_ = len(g[0]), len(p[0])
    if any(len(r) != np_ for r in p):
        return False, "predição com linhas de larguras diferentes"
    if np_ < ng:
        return False, f"colunas {np_}<{ng}"

    def tenta(gcols: list[int], loose: bool = False) -> bool:
        """Existe atribuição injetiva de `gcols` que também alinha as linhas?"""
        cand = []
        for gi in gcols:
            gcol = _col(g, gi)
            ok = [
                pj for pj in range(np_)
                if (_cols_equal(gcol, _col(p, pj), loose) if ordered
                    else _multiconjuntos_iguais(gcol, _col(p, pj), loose))
            ]
            if not ok:
                return False
            cand.append(ok)

        for atrib in _atribuicoes(cand):
            gt = [tuple(r[gi] for gi in gcols) for r in g]
            pt = [tuple(r[pj] for pj in atrib) for r in p]
            if not ordered:
                gt, pt = _ordena_tuplas(gt), _ordena_tuplas(pt)
            # A verificação linha a linha é o que preserva a associação
            # rótulo↔valor: sem ela, trocar as contagens entre dois grupos
            # passaria batido.
            if all(
                len(a) == len(b) and all(cells_equal(x, y, loose) for x, y in zip(a, b))
                for a, b in zip(gt, pt)
            ):
                return True
        return False

    todas_g = list(range(ng))
    if tenta(todas_g):
        return True, "exato" if ng == np_ else "superset"

    # Modo frouxo: mesmas linhas, mesmos números, rótulos escritos de outro
    # jeito ('menor de 1 ano' vs 'Menores de 1 ano'). O alinhamento das linhas
    # continua exigido, então grupos realmente distintos não passam.
    if tenta(todas_g, loose=True):
        return True, "rótulo≈"

    return False, "valores≠"


def _ordena_tuplas(rows: list[tuple]) -> list[tuple]:
    return sorted(rows, key=lambda r: tuple(_chave_ordem(v) for v in r))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--category", default=None)
    ap.add_argument("--ids", default=None, help="lista separada por vírgula")
    ap.add_argument("--model", default=None, help="sobrescreve SQL_MODEL")
    ap.add_argument(
        "--workers", type=int, default=8,
        help="casos avaliados em paralelo. O gargalo é a API, não o DuckDB.",
    )
    ap.add_argument(
        "--recusa", choices=("inclui", "exclui", "apenas"), default="inclui",
        help=(
            "o que fazer com os casos irrespondíveis. `exclui` pula os 35 casos "
            "de recusa e economiza ~10%% da conta — útil para iterar na geração "
            "de SQL. NÃO use na execução que você vai registrar como medição: a "
            "recusa é a única métrica que pega o erro de responder uma pergunta "
            "vizinha, que é o erro que não parece erro. `apenas` roda só eles."
        ),
    )
    ap.add_argument(
        "--nota", default="",
        help=(
            "uma frase dizendo o que esta execução testa — 'depois de reescrever "
            "a regra de sexo'. Vai para o índice, e é o que faz duas linhas da "
            "tabela serem comparáveis daqui a um mês."
        ),
    )
    args = ap.parse_args()
    # O comando é gravado junto do resultado: `--limit 20` e a rodada completa
    # produzem acurácias que não se comparam, e três semanas depois ninguém
    # lembra qual número veio de qual recorte.
    # `shlex.join` e não `" ".join`: sem as aspas, `--nota "duas palavras"`
    # é gravado como algo que, colado de volta no terminal, faz outra coisa.
    comando = "python -m eval.run_eval " + shlex.join(sys.argv[1:])

    if args.model:
        object.__setattr__(settings, "sql_model", args.model)
        object.__setattr__(settings, "answer_model", args.model)

    with open(settings.ground_truth_file, encoding="utf-8") as fh:
        cases = yaml.safe_load(fh)["cases"]

    # O recorte de recusa vem ANTES de `--limit`, senão `--limit 10 --recusa
    # exclui` devolveria menos de 10 casos — cortaria os irrespondíveis de
    # dentro dos 10 já escolhidos, em vez de escolher 10 respondíveis.
    total_bruto = len(cases)
    if args.recusa == "exclui":
        cases = [c for c in cases if c.get("answerable", True)]
    elif args.recusa == "apenas":
        cases = [c for c in cases if not c.get("answerable", True)]
    pulados = total_bruto - len(cases)

    if args.category:
        cases = [c for c in cases if c["category"] == args.category]
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        cases = [c for c in cases if c["id"] in wanted]
    if args.limit:
        cases = cases[: args.limit]

    db = Database()
    agent = TextToSQLAgent(db=db)

    results = []
    by_cat: dict[str, list[bool]] = defaultdict(list)
    t0 = time.time()

    print(f"Avaliando {len(cases)} casos com modelo '{settings.sql_model}' "
          f"({args.workers} em paralelo)")
    if args.recusa == "exclui":
        print(f"  {pulados} casos irrespondíveis fora desta execução")
    elif args.recusa == "apenas":
        print(f"  só os casos irrespondíveis — esta execução não mede execution accuracy")
    print()
    print(f"{'id':<34} {'categoria':<20} {'status':<10} tempo")
    print("-" * 80)

    def avaliar(case: dict) -> dict:
        cid = case["id"]
        expect_answerable = case.get("answerable", True)
        ordered = case.get("ordered", False)
        started = time.time()

        rec: dict = {
            "id": cid,
            "category": case["category"],
            "difficulty": case.get("difficulty"),
            "question": case["question"],
            "expect_answerable": expect_answerable,
        }

        try:
            out = agent.ask(case["question"])
        except Exception as exc:  # noqa: BLE001
            rec |= {
                "correct": False,
                "status": "EXCEÇÃO",
                "error": str(exc),
                "elapsed_s": round(time.time() - started, 2),
            }
            return rec

        rec |= {
            "predicted_sql": out.sql,
            "answer": out.answer,
            "got_answerable": out.answerable,
            "attempts": out.attempts,
            "errors": out.errors,
        }

        if not expect_answerable:
            correct = not out.answerable
            status = "OK" if correct else "NÃO RECUSOU"
        elif not out.answerable:
            correct, status = False, "RECUSOU"
        elif out.result is None:
            correct, status = False, "SQL FALHOU"
        else:
            # Reexecuta o gold aqui para comparar sob as mesmas condições.
            gold = db.run(case["gold_sql"], add_limit=False)
            correct, modo = results_match(gold.rows, out.result.rows, ordered)
            status = {"exato": "OK", "superset": "OK+extra", "rótulo≈": "OK~rótulo"}.get(
                modo, "RESULTADO≠"
            ) if correct else "RESULTADO≠"
            rec["match_mode"] = modo
            rec["gold_n_rows"] = len(gold.rows)
            rec["pred_n_rows"] = len(out.result.rows)

            # Alguns casos exigem que a RESPOSTA carregue uma ressalva, não só
            # que o SQL esteja certo. Cada item é uma lista de sinônimos: basta
            # um deles aparecer.
            if correct and (required := case.get("answer_must_mention")):
                answer_lc = (out.answer or "").lower()
                missing = [
                    alts for alts in required
                    if not any(alt.lower() in answer_lc for alt in alts)
                ]
                if missing:
                    correct = False
                    status = "SEM RESSALVA"
                    rec["missing_caveats"] = missing
            if not correct:
                rec["gold_sample"] = [
                    [str(v) for v in r] for r in gold.rows[:3]
                ]
                rec["pred_sample"] = [
                    [str(v) for v in r] for r in out.result.rows[:3]
                ]

        rec |= {"correct": correct, "status": status, "elapsed_s": round(time.time() - started, 2)}
        return rec

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futuros = {pool.submit(avaliar, c): c for c in cases}
        for fut in as_completed(futuros):
            rec = fut.result()
            results.append(rec)
            by_cat[rec["category"]].append(rec["correct"])
            mark = "✓" if rec["correct"] else "✗"
            print(f"{rec['id']:<34} {rec['category']:<20} {mark} {rec['status']:<8} "
                  f"{rec.get('elapsed_s', 0):5.1f}s", flush=True)

    # Restaura a ordem do ground truth, que o paralelismo embaralha.
    ordem = {c["id"]: i for i, c in enumerate(cases)}
    results.sort(key=lambda r: ordem[r["id"]])

    # ---------------- relatório ----------------
    n = len(results)
    n_ok = sum(r["correct"] for r in results)
    answerable = [r for r in results if r["expect_answerable"]]
    unanswerable = [r for r in results if not r["expect_answerable"]]
    exec_ok = sum(r["correct"] for r in answerable)
    ref_ok = sum(r["correct"] for r in unanswerable)
    valid_sql = sum(
        1 for r in answerable if r.get("predicted_sql") and r.get("status") != "SQL FALHOU"
    )

    print("\n" + "=" * 80)
    if unanswerable:
        print(f"ACURÁCIA GERAL              {n_ok}/{n}  ({100*n_ok/n:.1f}%)")
        print(f"Execution accuracy          {exec_ok}/{len(answerable)}  ({100*exec_ok/len(answerable):.1f}%)")
        print(f"SQL executável              {valid_sql}/{len(answerable)}  ({100*valid_sql/len(answerable):.1f}%)")
        print(f"Recusa correta              {ref_ok}/{len(unanswerable)}  ({100*ref_ok/len(unanswerable):.1f}%)")
    else:
        # Sem irrespondíveis, "geral" e "execution accuracy" seriam o mesmo
        # número sobre o mesmo conjunto. Uma linha só, e ela fala dos casos que
        # rodaram — não há nada a afirmar sobre os que ficaram de fora.
        print(f"CASOS AVALIADOS             {n}")
        print(f"ACURÁCIA                    {n_ok}/{n}  ({100*n_ok/n:.1f}%)")
        print(f"SQL executável              {valid_sql}/{n}  ({100*valid_sql/n:.1f}%)")

    print("\nPor categoria:")
    for cat, vals in sorted(by_cat.items(), key=lambda kv: (sum(kv[1]) / len(kv[1]))):
        print(f"  {cat:<22} {sum(vals)}/{len(vals)}  ({100*sum(vals)/len(vals):.0f}%)")

    fails = [r for r in results if not r["correct"]]
    if fails:
        print(f"\nFalhas ({len(fails)}):")
        for r in fails:
            print(f"  ✗ {r['id']} [{r['status']}] — {r['question']}")

    print(f"\nTempo total: {time.time()-t0:.0f}s")

    # Uma pasta por execução, numerada. A pasta é criada só AGORA, depois de os
    # casos rodarem: uma execução interrompida na metade não deixa um número
    # queimado nem uma pasta vazia no índice.
    pasta, numero = resultados.abrir_execucao()
    dados = {
        "model": settings.sql_model,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "run": numero,
        "command": comando,
        "note": args.nota,
        # Qual recorte do conjunto rodou. Sem isso, uma execução parcial entra
        # no índice com uma acurácia que parece comparável à de uma completa.
        "recusa": args.recusa,
        "skipped": pulados,
        "n_cases": n,
        "accuracy": round(n_ok / n, 4),
        "execution_accuracy": round(exec_ok / len(answerable), 4) if answerable else None,
        "refusal_accuracy": round(ref_ok / len(unanswerable), 4) if unanswerable else None,
        "by_category": {k: [sum(v), len(v)] for k, v in by_cat.items()},
        "results": results,
    }
    (pasta / "relatorio.json").write_text(
        json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    resultados.escrever_resumo(pasta, dados, comando, args.nota)
    indice = resultados.reescrever_indice()

    print(f"\nExecução {numero} -> {pasta.relative_to(Path.cwd()) if pasta.is_relative_to(Path.cwd()) else pasta}")
    print(f"  resumo.md       o resultado em uma tela")
    print(f"  relatorio.json  o detalhe caso a caso")
    print(f"Histórico -> {indice.relative_to(Path.cwd()) if indice.is_relative_to(Path.cwd()) else indice}")
    return 0 if n_ok == n else 1


if __name__ == "__main__":
    raise SystemExit(main())
