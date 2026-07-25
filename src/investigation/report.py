"""Síntese do texto e serialização do relatório para a interface."""

from __future__ import annotations

from ..agent import _json_safe
from ..config import settings
from ..llm import complete
from . import contracts
from .models import Achado, Relatorio

# Quantas linhas de cada evidência o sintetizador enxerga. Mais que isso enche o
# contexto com tabela e o texto vira transcrição em vez de análise.
LINHAS_PARA_SINTESE = 20
# Quantas linhas por bloco vão para a interface. A tabela do relatório é para
# ler, não para exportar — o usuário tem o SQL se quiser o conjunto inteiro.
LINHAS_PARA_UI = 200


def sintetizar(pergunta: str, leitura: str, achados: list[Achado], lacuna: str) -> str:
    evidencias = "\n\n".join(a.para_prompt(LINHAS_PARA_SINTESE) for a in achados)
    user = f"Pergunta: {pergunta}\n\nLeitura do planejador: {leitura}\n\n{evidencias}"
    if lacuna:
        user += f"\n\n## LACUNA QUE NÃO FOI FECHADA\n{lacuna}"
    return complete(
        model=settings.answer_model,
        system=contracts.SINTESE,
        messages=[{"role": "user", "content": user}],
        reasoning_effort="low",
    )


def bloco_para_json(achado: Achado) -> dict:
    res = achado.resultado
    return {
        "question": achado.etapa.pergunta,
        "purpose": achado.etapa.proposito,
        "origin": achado.etapa.origem,
        "sql": achado.sql,
        "error": achado.erro,
        "definition": achado.definicao,
        "assumptions": achado.suposicoes,
        "chart": achado.chart,
        "result": (
            {
                "columns": res.columns,
                "rows": [[_json_safe(v) for v in linha] for linha in res.rows[:LINHAS_PARA_UI]],
                "nRows": len(res.rows),
                "elapsed": round(res.elapsed_s, 3),
                "truncated": len(res.rows) > LINHAS_PARA_UI,
            }
            if res
            else None
        ),
    }


def para_json(rel: Relatorio) -> dict:
    """Formato que o painel de relatório consome. Espelhado em types.ts."""
    return {
        "question": rel.pergunta,
        "reading": rel.leitura,
        "text": rel.texto,
        "gap": rel.lacuna,
        "refusal": rel.recusa,
        "elapsed": round(rel.segundos, 1),
        "llmCalls": rel.chamadas_llm,
        "stepsOk": rel.etapas_ok,
        "stepsFromReflection": rel.etapas_de_reflexao,
        "blocks": [bloco_para_json(a) for a in rel.achados],
    }
