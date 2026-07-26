"""Para onde vai uma pergunta feita dentro de um tema: banco, web, ou os dois.

Existe porque a alternativa é pior. Sem roteamento, "busque na internet quantos
mortos a covid teve em 2020" vira SQL — e o agente responde com um número do
SIH, que é o que a pessoa acabou de dizer que NÃO queria. A pergunta é
respondida com confiança e está errada, que é o pior modo de errar.

O desenho segue o mesmo padrão do resto do projeto: o modelo DECLARA o destino,
o código EXECUTA. O modelo não busca nada, não escreve SQL aqui, não decide o
que é confiável — devolve um destino e uma consulta de busca limpa, e quem
chama faz o resto. Um roteador que só classifica é um roteador que dá para
testar.

Duas regras que valem a pena guardar:

  O PADRÃO É O BANCO. Errar para "web" numa pergunta que o SIH responde troca um
  número apurado por um link — é uma piora clara. Errar para "banco" numa
  pergunta que pedia a web devolve dado do SIH, e a pessoa repete o pedido com
  "na internet". A assimetria é de propósito.

  ISTO NÃO TOCA /api/ask. Vale só no chat do tema. O caminho da avaliação
  continua sendo pergunta → SQL, sem passo intermediário, porque acrescentar uma
  chamada de modelo antes da geração de SQL mudaria o que os 272 casos medem.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from . import llm
from .config import settings

# `ambos` é o caso de "quantas internações por covid tivemos, e o que o
# Ministério dizia sobre notificação naquele ano?": o número vem do banco, o
# contexto vem de fora, e separar em duas perguntas seria trabalho do usuário.
Destino = Literal["banco", "web", "ambos"]

ESQUEMA_ROTA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["destino", "pergunta_banco", "consulta_web", "motivo"],
    "properties": {
        "destino": {
            "type": "string",
            "enum": ["banco", "web", "ambos"],
        },
        "pergunta_banco": {
            "type": "string",
            "description": (
                "Só quando o destino é 'ambos': a METADE da pergunta que o SIH responde, "
                "reescrita para se sustentar sozinha. String vazia nos outros destinos. "
                "Ex.: de 'quantas internações por covid em 2021 e o que o Ministério dizia "
                "sobre notificação?' sai 'quantas internações por covid em 2021?'."
            ),
        },
        "consulta_web": {
            "type": "string",
            "description": (
                "Uma linha de busca, quando o destino inclui a web; string vazia quando "
                "não. NO MÁXIMO 12 PALAVRAS, como alguém digitaria numa busca. Não empilhe "
                "sinônimos nem repita a mesma ideia — isso piora o resultado. Sem 'busque "
                "na internet sobre', sem pronomes soltos: resolva o que a pergunta deixou "
                "implícito usando o assunto do tema."
            ),
        },
        "motivo": {
            "type": "string",
            "description": "Uma frase curta, para aparecer na interface.",
        },
    },
}

SISTEMA_ROTA = """Você decide para onde vai uma pergunta feita dentro de um tema \
de investigação sobre internações hospitalares do SUS.

O QUE O BANCO TEM: SIH/SUS (AIH de internação), 2007 a 2024, 144 milhões de \
registros. Diagnóstico (CID-10), procedimento, UF, município, sexo, idade, \
óbito na internação, valor pago, dias de permanência, caráter da internação.

O QUE O BANCO NÃO TEM: mortes fora do hospital (o SIM é outra base), casos \
notificados, população para calcular taxa por habitante, vacinação, atendimento \
ambulatorial, rede privada sem SUS, portarias, notas técnicas, mudanças de \
regra de preenchimento, literatura.

destino = "banco"
  O padrão. Qualquer coisa contável nos campos acima. Na dúvida, banco.

destino = "web"
  A pessoa pediu a internet de forma explícita ("busque na internet", \
"pesquise", "o que dizem sobre"), OU a resposta exige algo que o banco não tem: \
número oficial de outra fonte, norma, nota técnica, definição de referência, \
artigo.

destino = "ambos"
  A pergunta tem as duas partes de verdade — um número que o banco dá e um \
contexto que só existe fora dele. Não use "ambos" por precaução; use quando \
remover uma das partes deixaria a pergunta pela metade.

  Aqui separe as duas metades: `pergunta_banco` é só o que o SIH responde. \
Isto importa — a pergunta inteira, com a parte de fora junto, faz o gerador de \
SQL recusar tudo, e a metade que ele daria se perde.

Você não busca nem consulta nada. Só classifica.

A consulta de busca é curta — no máximo 12 palavras. A busca é feita em fontes \
oficiais e científicas (DATASUS, gov.br, IBGE, Fiocruz, SciELO, OMS), então não \
adianta acrescentar "fonte oficial" ou nomes de órgãos aos termos: o filtro já \
existe, e palavra a mais só dilui o que importa."""


@dataclass
class Rota:
    destino: Destino
    pergunta_banco: str = ""
    consulta_web: str = ""
    motivo: str = ""

    @property
    def usa_banco(self) -> bool:
        return self.destino in ("banco", "ambos")

    @property
    def usa_web(self) -> bool:
        return self.destino in ("web", "ambos") and bool(self.consulta_web)

    def para_o_banco(self, pergunta: str) -> str:
        """O que vai para o gerador de SQL — a metade, quando há duas."""
        return self.pergunta_banco or pergunta

    def para_json(self) -> dict:
        return {
            "destination": self.destino,
            "dbQuestion": self.pergunta_banco,
            "query": self.consulta_web,
            "reason": self.motivo,
        }


def rotear(pergunta: str, *, assunto: str = "") -> Rota:
    """Classifica a pergunta. Qualquer falha vira `banco` — o caminho de sempre.

    `assunto` é o título do tema: sem ele, "e no ano seguinte?" não tem como
    virar uma consulta de busca que faça sentido sozinha.
    """
    contexto = f"Tema da investigação: {assunto}\n\n" if assunto else ""
    try:
        bruto = llm.complete(
            model=settings.sql_model,
            system=SISTEMA_ROTA,
            messages=[{"role": "user", "content": f"{contexto}Pergunta: {pergunta}"}],
            schema=ESQUEMA_ROTA,
            schema_name="rota",
            reasoning_effort="minimal",
        )
    except Exception:  # noqa: BLE001
        return Rota(destino="banco", motivo="")

    assert isinstance(bruto, dict)
    destino = bruto.get("destino")
    if destino not in ("banco", "web", "ambos"):
        destino = "banco"

    consulta = " ".join(str(bruto.get("consulta_web") or "").split())[:300]
    # Um destino de web sem consulta não é executável. Cair para o banco aqui é
    # melhor que emitir uma busca vazia: pelo menos a pergunta é respondida.
    if destino == "web" and not consulta:
        destino = "banco"

    return Rota(
        destino=destino,  # type: ignore[arg-type]
        # A metade do banco só faz sentido em "ambos": em "banco" a pergunta
        # inteira já é dela, e reescrevê-la só daria chance de perder detalhe.
        pergunta_banco=(
            " ".join(str(bruto.get("pergunta_banco") or "").split())[:500]
            if destino == "ambos"
            else ""
        ),
        consulta_web=consulta if destino in ("web", "ambos") else "",
        motivo=" ".join(str(bruto.get("motivo") or "").split())[:200],
    )
