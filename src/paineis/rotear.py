"""Um pedido do painel é um filtro ou um widget. Decidir isso é uma classificação.

Sem este passo, a caixa da tela precisaria de dois botões — "montar gráfico" e
"criar filtro" — e a pessoa teria de saber de antemão em qual categoria o pedido
dela cai. "Quero ver só mulheres" é filtro; "quero um gráfico por sexo" é
widget; a fronteira é sutil e não é trabalho de quem usa.

Uma chamada só, e barata: o modelo devolve uma palavra.
"""

from __future__ import annotations

from typing import Literal

from ..config import settings
from ..llm import complete

Alvo = Literal["widget", "filtro"]

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["alvo", "motivo"],
    "properties": {
        "alvo": {"type": "string", "enum": ["widget", "filtro"]},
        "motivo": {"type": "string", "description": "Meia frase, para a interface."},
    },
}

SISTEMA = """Você classifica um pedido feito na caixa de um painel de dados.

"widget" — a pessoa quer VER algo novo: um gráfico, uma série, um total, um
ranking, um indicador. Ex.: "óbitos por ano", "mostre um gráfico de internações
por região", "quero o total de partos".

"filtro" — a pessoa quer RECORTAR o que já está na tela, e o recorte vale para
todos os gráficos de uma vez. Ex.: "adicione um filtro por sexo", "quero poder
escolher a faixa etária", "filtre por diagnóstico", "quero ver só o RS".

A pista mais confiável não é a palavra "filtro": é se o pedido acrescenta uma
LEITURA (widget) ou um CONTROLE que recorta as leituras existentes (filtro).
"Quero ver só mulheres" é filtro mesmo sem dizer a palavra; "um gráfico por
sexo" é widget mesmo falando de sexo.

Na dúvida entre os dois, responda "widget": acrescentar um gráfico a mais é
reversível com um clique, e um filtro criado sem querer muda o painel inteiro."""


def rotear(pedido: str) -> tuple[Alvo, str]:
    """Devolve para onde o pedido vai. Qualquer falha vira `widget`."""
    try:
        bruto = complete(
            model=settings.sql_model,
            system=SISTEMA,
            messages=[{"role": "user", "content": pedido}],
            schema=ESQUEMA,
            schema_name="alvo",
            reasoning_effort="minimal",
        )
    except Exception:  # noqa: BLE001
        return "widget", ""
    assert isinstance(bruto, dict)
    alvo = bruto.get("alvo") if bruto.get("alvo") in ("widget", "filtro") else "widget"
    return alvo, str(bruto.get("motivo") or "")[:160]  # type: ignore[return-value]
