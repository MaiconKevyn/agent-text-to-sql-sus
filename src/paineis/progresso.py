"""As etapas que o painel relata enquanto trabalha.

Montar um widget leva de dez a quarenta segundos e um plano de análise leva dois
minutos. Nesse tempo a tela mostrava um cartão girando, e girar não distingue
"está escrevendo a consulta" de "travou" — foi assim que uma chamada sem prazo
ficou nove minutos sem ninguém saber.

A regra deste módulo, e a razão de ele existir em vez de uma animação no
cliente: TODA ETAPA É UM FATO. Ela aparece quando aquele trabalho começa de
verdade e fecha quando ele termina de verdade, com o que produziu no detalhe —
"2 opções", "27 linhas", "9 itens". Uma barra de progresso que avança sozinha
seria mais bonita e diria menos: com o modelo demorando quarenta segundos, ela
chegaria ao fim aos oito e ficaria parada ali, mentindo com convicção.

Por isso também não há porcentagem. Ninguém sabe quanto falta — o que dá para
dizer com honestidade é o que está acontecendo agora e o que já ficou pronto.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

# "fazendo" acende a etapa; "feita" a fecha com o resultado; "falhou" a marca e
# encerra o trabalho.
FAZENDO, FEITA, FALHOU = "fazendo", "feita", "falhou"


@dataclass
class Passo:
    id: str
    rotulo: str
    estado: str = FAZENDO
    # O que aquela etapa produziu. É o que transforma a lista num relato: sem
    # ele, "Lendo os valores no banco ✓" e "Escrevendo a consulta ✓" contam a
    # mesma história para qualquer pedido.
    detalhe: str = ""

    def para_json(self) -> dict:
        return {"id": self.id, "label": self.rotulo, "state": self.estado, "detail": self.detalhe}


# Quem recebe os passos. `None` desliga o relato — é o que os testes e o CLI
# usam, e é por isso que anunciar etapa não pode ter efeito nenhum além de
# anunciar.
Relator = Callable[[Passo], None] | None


def relata(
    relator: Relator, id_: str, rotulo: str, estado: str = FAZENDO, detalhe: str = ""
) -> None:
    if relator is not None:
        relator(Passo(id_, rotulo, estado, detalhe))


def fecha(relator: Relator, id_: str, rotulo: str, detalhe: str = "") -> None:
    relata(relator, id_, rotulo, FEITA, detalhe)
