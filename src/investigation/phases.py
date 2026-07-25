"""As três fases da investigação: planejar, executar, refletir.

Cada fase é uma função pura sobre o que recebe — nenhuma guarda estado. O
`Investigador` (runner.py) as encadeia e é o único a controlar orçamento.
"""

from __future__ import annotations

import concurrent.futures as cf

from ..agent import TextToSQLAgent, _clean_sql, _valida_chart
from ..config import settings
from ..llm import complete
from ..value_linker import link_values
from . import contracts
from .models import Achado, Etapa, Reflexao

# Etapas do mesmo lote são independentes por construção — vão em paralelo.
WORKERS = 4


def planejar(pergunta: str) -> dict:
    """Transforma a pergunta num plano de etapas. Uma chamada de LLM."""
    return complete(
        model=settings.sql_model,
        system=contracts.PLANO,
        messages=[{"role": "user", "content": f"Pergunta do usuário: {pergunta}"}],
        schema=contracts.PLANO_SCHEMA,
        schema_name="plano_investigacao",
        reasoning_effort="medium",
    )


def refletir(pergunta: str, achados: list[Achado], restante: int) -> Reflexao:
    """Diagnostica buracos no argumento. Uma chamada de LLM.

    Devolve o diagnóstico; quem decide se basta é `Reflexao.suficiente`.
    """
    evidencias = "\n\n".join(a.para_prompt() for a in achados)
    user = (
        f"Pergunta original: {pergunta}\n\n"
        f"{_fatos(achados)}\n"
        f"## EVIDÊNCIAS COLETADAS\n{evidencias}\n\n"
        f"Orçamento restante: {restante} etapa(s)."
    )
    bruto = complete(
        model=settings.sql_model,
        system=contracts.REFLEXAO,
        messages=[{"role": "user", "content": user}],
        schema=contracts.REFLEXAO_SCHEMA,
        schema_name="reflexao",
        reasoning_effort="medium",
    )
    return Reflexao.de_dict(bruto, restante)


def _fatos(achados: list[Achado]) -> str:
    """O que o código sabe sem precisar perguntar ao modelo.

    Uma etapa que falhou é fato observável, não julgamento — e enterrada no meio
    de cinco tabelas o modelo passava batido por ela. Aqui ela vem no topo.
    """
    falhas = [a for a in achados if not a.ok]
    vazias = [a for a in achados if a.ok and a.resultado is not None and not a.resultado.rows]
    linhas = [f"- {len(achados)} etapa(s) executada(s), {len(achados) - len(falhas)} com resultado."]
    for a in falhas:
        linhas.append(f"- FALHOU: {a.etapa.pergunta[:110]} — {(a.erro or '')[:90]}")
    for a in vazias:
        linhas.append(f"- VOLTOU VAZIA: {a.etapa.pergunta[:110]}")
    return "## FATOS APURADOS PELO SISTEMA\n" + "\n".join(linhas) + "\n"


def descrever_definicao(pergunta: str, sql: str, raciocinio: str) -> str:
    """Traduz o recorte que a query aplicou para uma frase que o leitor entende.

    O SQL já contém a definição, mas enterrada: `DIAG_PRINC LIKE 'C%' OR
    DIAG_PRINC BETWEEN 'D00' AND 'D48'` é "câncer" para quem lê o rótulo do
    gráfico e "todas as neoplasias" para quem lê o código. Esta é a diferença
    entre um número certo com rótulo certo e um número certo com rótulo errado.
    """
    user = f"Pergunta: {pergunta}\n\nSQL:\n{sql}"
    if raciocinio:
        user += f"\n\nRaciocínio do gerador:\n{raciocinio}"
    try:
        return complete(
            model=settings.answer_model,
            system=contracts.DEFINICAO,
            messages=[{"role": "user", "content": user}],
            reasoning_effort="low",
        ).strip()
    except Exception:  # noqa: BLE001 — a definição é um extra; não derruba a etapa
        return ""


class Executor:
    """Roda etapas reusando o agente inteiro.

    Reusar o `TextToSQLAgent` em vez de falar com o LLM direto é o que traz de
    graça o dicionário curado, o value linking e o reparo de SQL. Uma etapa da
    investigação é, para todos os efeitos, uma pergunta normal do produto.
    """

    def __init__(self, agente: TextToSQLAgent, com_definicao: bool = True):
        self.agente = agente
        self.com_definicao = com_definicao

    def uma(self, etapa: Etapa) -> Achado:
        achado = Achado(etapa=etapa)
        try:
            hints = link_values(self.agente.db, etapa.pergunta)
            plano = self.agente.generate_sql(etapa.pergunta, hints=hints)

            if not plano.get("answerable"):
                achado.erro = plano.get("refusal") or "fora do alcance da base"
                return achado

            res, sql, _, erros = self.agente._execute_with_repair(etapa.pergunta, plano, hints)
            achado.sql = _clean_sql(sql)
            achado.suposicoes = list(plano.get("assumptions") or [])

            if res is None:
                achado.erro = erros[-1] if erros else "execução falhou"
                return achado

            achado.resultado = res
            achado.chart, _ = _valida_chart(plano.get("chart"), res)
            if self.com_definicao:
                achado.definicao = descrever_definicao(
                    etapa.pergunta, achado.sql, plano.get("reasoning", "")
                )
        except Exception as exc:  # noqa: BLE001 — uma etapa que explode não derruba o relatório
            achado.erro = f"{type(exc).__name__}: {exc}"
        return achado

    def lote(self, etapas: list[Etapa]) -> list[Achado]:
        if not etapas:
            return []
        if len(etapas) == 1:
            return [self.uma(etapas[0])]
        with cf.ThreadPoolExecutor(max_workers=min(WORKERS, len(etapas))) as pool:
            return list(pool.map(self.uma, etapas))
