"""Onde cada execução da avaliação é guardada, e como as execuções se comparam.

Antes disto havia um arquivo só, `eval/eval_report.json`, reescrito a cada
rodada. Duas consequências, e a segunda é a que importa:

  A MEDIÇÃO ANTERIOR ERA PERDIDA. Rodar de novo apagava o que se tinha antes de
  mexer no prompt — justamente a metade da comparação.

  E SEM COMPARAÇÃO NÃO HÁ COMO SABER SE UMA MUDANÇA AJUDOU. A acurácia deste
  agente varia de uns 4 pontos entre execuções idênticas: 15% das falhas passam
  numa segunda tentativa, sem nada mudar no código. Um número solto não
  distingue melhora de ruído; só a série distingue.

Daí a forma: uma pasta por execução, numerada em ordem de acontecimento, e um
índice que põe todas em uma tabela.

    eval/results/
      indice.md            uma linha por execução — é o que se lê primeiro
      eval_001/
        resumo.md          o que dá para ler sem ferramenta
        relatorio.json     o detalhe caso a caso
      eval_002/
        …

O número tem três dígitos porque `eval_10` vem antes de `eval_2` em qualquer
ordenação de texto — no `ls`, no navegador de arquivos, no próprio índice.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

RESULTADOS = Path(__file__).resolve().parent / "results"
_NOME = re.compile(r"^eval_(\d+)$")


def execucoes() -> list[Path]:
    """As pastas de execução existentes, da mais antiga para a mais nova."""
    if not RESULTADOS.is_dir():
        return []
    achadas = [(int(m.group(1)), p) for p in RESULTADOS.iterdir() if (m := _NOME.match(p.name))]
    return [p for _, p in sorted(achadas)]


def proximo_numero() -> int:
    """O número desta execução: o maior já usado, mais um.

    Contar as pastas existentes daria o número errado depois de apagar uma do
    meio — duas execuções acabariam com o mesmo número, e a que chegasse depois
    sobrescreveria a anterior. O maior + 1 nunca colide.
    """
    usados = [int(m.group(1)) for p in execucoes() if (m := _NOME.match(p.name))]
    return max(usados, default=0) + 1


def ultimo_relatorio() -> Path | None:
    """O `relatorio.json` da execução mais recente, ou `None` se não houver.

    É o que `rescore.py` e `disambiguate.py` usam quando ninguém passa caminho.
    Antes eles apontavam para um `eval_report.json` fixo; com uma pasta por
    execução, "o último" deixa de ser um lugar e passa a ser uma pergunta.
    """
    for pasta in reversed(execucoes()):
        alvo = pasta / "relatorio.json"
        if alvo.is_file():
            return alvo
    return None


def abrir_execucao() -> tuple[Path, int]:
    """Cria a pasta desta execução e devolve (caminho, número)."""
    n = proximo_numero()
    pasta = RESULTADOS / f"eval_{n:03d}"
    pasta.mkdir(parents=True, exist_ok=False)
    return pasta, n


# --------------------------------------------------------------------------- #
# O resumo legível
# --------------------------------------------------------------------------- #
def escrever_resumo(pasta: Path, dados: dict, comando: str, nota: str = "") -> Path:
    """O `resumo.md`: o que se quer saber sem abrir 400 KB de JSON.

    Traz o comando que produziu a execução, e é isso que torna um número
    comparável com outro: `--limit 20` e a rodada completa produzem acurácias
    que não se comparam, e sem o comando registrado ninguém lembra qual foi qual
    três semanas depois.
    """
    r = dados["results"]
    respondiveis = [x for x in r if x["expect_answerable"]]
    recusaveis = [x for x in r if not x["expect_answerable"]]
    falhas = [x for x in r if not x["correct"]]

    def pct(a: int, b: int) -> str:
        return f"{a}/{b} ({100*a/b:.1f}%)" if b else "—"

    linhas = [
        f"# Execução {pasta.name.removeprefix('eval_').lstrip('0') or '0'}",
        "",
        f"- **quando** {dados['timestamp']}",
        f"- **modelo** `{dados['model']}`",
        f"- **comando** `{comando}`",
    ]
    if nota:
        linhas.append(f"- **nota** {nota}")
    # Uma execução parcial precisa dizer isso na primeira tela. O número dela é
    # legítimo, mas não é o mesmo número de uma rodada completa, e quem só olha
    # a acurácia não tem como perceber a diferença.
    if (modo := dados.get("recusa", "inclui")) != "inclui":
        linhas += [
            "",
            f"> **Execução parcial** (`--recusa {modo}`): "
            + (
                f"os {dados.get('skipped', 0)} casos irrespondíveis ficaram de fora. "
                "Não mede recusa, e a acurácia geral aqui é a execution accuracy — "
                "não compare com a de uma rodada completa."
                if modo == "exclui"
                else "só os casos irrespondíveis rodaram. Não mede execution accuracy."
            ),
        ]
    linhas += [
        "",
        "## Resultado",
        "",
        "| | |",
        "|---|---|",
        f"| Acurácia geral | {pct(sum(x['correct'] for x in r), len(r))} |",
        f"| Execution accuracy | {pct(sum(x['correct'] for x in respondiveis), len(respondiveis))} |",
        f"| Recusa correta | {pct(sum(x['correct'] for x in recusaveis), len(recusaveis))} |",
        "",
        "## Por categoria",
        "",
        "| categoria | acertos |",
        "|---|---|",
    ]
    for cat, (ok, total) in sorted(
        dados["by_category"].items(), key=lambda kv: kv[1][0] / kv[1][1]
    ):
        linhas.append(f"| {cat} | {pct(ok, total)} |")

    if falhas:
        linhas += ["", f"## Falhas · {len(falhas)}", ""]
        for x in falhas:
            linhas.append(f"- `{x['id']}` **[{x['status']}]** — {x['question']}")

    linhas += [
        "",
        "---",
        "",
        "O detalhe caso a caso — SQL previsto, linhas devolvidas, erros — está em",
        "`relatorio.json`, ao lado deste arquivo.",
        "",
    ]
    destino = pasta / "resumo.md"
    destino.write_text("\n".join(linhas), encoding="utf-8")
    return destino


# --------------------------------------------------------------------------- #
# O índice
# --------------------------------------------------------------------------- #
CABECALHO = """# Execuções da avaliação

Uma linha por execução, da mais recente para a mais antiga. O detalhe de cada
uma está em `eval_NNN/resumo.md`.

**A acurácia deste agente varia uns 4 pontos entre execuções idênticas** — 15%
das falhas passam numa segunda tentativa sem nada mudar no código. Uma variação
menor que isso entre duas linhas desta tabela não é sinal; é ruído.

`ᵖ` marca execução parcial — rodou um recorte do conjunto, então a acurácia
geral dela não se compara com a de uma linha sem a marca.

| # | quando | modelo | casos | geral | execução | recusa | nota |
|---|---|---|---|---|---|---|---|
"""


def reescrever_indice() -> Path:
    """Refaz o índice inteiro a partir das pastas.

    Reconstruir em vez de acrescentar uma linha: assim apagar uma pasta de
    execução some do índice sozinho, e um índice que mente sobre o que existe é
    pior que índice nenhum.
    """
    linhas = []
    for pasta in reversed(execucoes()):
        try:
            d = json.loads((pasta / "relatorio.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            linhas.append(f"| {pasta.name} | — | — | — | — | — | — | relatório ilegível |")
            continue
        n = pasta.name.removeprefix("eval_").lstrip("0") or "0"
        quando = d.get("timestamp", "")[:16].replace("T", " ")
        p = lambda v: f"{100*v:.1f}%" if isinstance(v, (int, float)) else "—"  # noqa: E731
        # Um "—" na coluna de recusa é ambíguo: pode ser que a amostra não tinha
        # irrespondíveis, ou que alguém os excluiu de propósito. A segunda muda
        # como se lê a linha inteira, então ela se nomeia.
        modo = d.get("recusa", "inclui")
        recusa = "excluída" if modo == "exclui" else p(d.get("refusal_accuracy"))
        geral = p(d.get("accuracy")) + (" ᵖ" if modo != "inclui" else "")
        linhas.append(
            f"| {n} | {quando} | `{d.get('model','?')}` | {d.get('n_cases','?')} | "
            f"{geral} | {p(d.get('execution_accuracy'))} | "
            f"{recusa} | {d.get('note','') or ''} |"
        )

    RESULTADOS.mkdir(parents=True, exist_ok=True)
    destino = RESULTADOS / "indice.md"
    destino.write_text(CABECALHO + "\n".join(linhas) + "\n", encoding="utf-8")
    return destino
