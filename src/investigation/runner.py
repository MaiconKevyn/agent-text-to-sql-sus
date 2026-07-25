"""Orquestração da investigação: encadeia as fases e é o único dono do orçamento."""

from __future__ import annotations

import time
from collections.abc import Iterator

from ..agent import TextToSQLAgent
from . import phases, report
from .contracts import MAX_ETAPAS, MAX_ETAPAS_REFLEXAO
from .models import Achado, Etapa, Relatorio


class Investigador:
    """Responde uma pergunta com várias consultas, em vez de uma só.

    O agente de pergunta única faz UMA hipótese analítica. O laço que ele tem
    (`_execute_with_repair`) é sintático: só dispara quando o SQL levanta
    exceção. Uma query que roda e responde a coisa errada passa batido.

    Aqui o laço é analítico — plano, execução paralela e uma rodada de reflexão
    que pode acrescentar etapas. Não é ReAct livre de propósito: cada etapa
    custa 1-2 chamadas de LLM mais uma varredura em 144 milhões de linhas, e sem
    teto uma investigação vira minutos sem limite superior conhecido.
    """

    def __init__(
        self,
        agente: TextToSQLAgent | None = None,
        max_etapas: int = MAX_ETAPAS,
        com_definicao: bool = True,
    ):
        self.agente = agente or TextToSQLAgent()
        self.max_etapas = max_etapas
        self.executor = phases.Executor(self.agente, com_definicao=com_definicao)

    def investigar(self, pergunta: str) -> Relatorio:
        """Roda a investigação inteira e devolve o relatório."""
        rel = Relatorio(pergunta=pergunta)
        for _ in self._passos(pergunta, rel):
            pass
        return rel

    def investigar_stream(self, pergunta: str) -> Iterator[dict]:
        """Mesma investigação, emitindo eventos conforme avança.

        Uma investigação leva minutos. Sem eventos, a interface fica muda o
        tempo todo e o usuário não sabe se travou.
        """
        rel = Relatorio(pergunta=pergunta)
        yield from self._passos(pergunta, rel)
        yield {"type": "report", "report": report.para_json(rel)}
        yield {"type": "done"}

    # -- o encadeamento, compartilhado pelas duas entradas -------------------
    def _passos(self, pergunta: str, rel: Relatorio) -> Iterator[dict]:
        t0 = time.perf_counter()

        yield {"type": "phase", "phase": "planejar", "state": "ativo"}
        plano = phases.planejar(pergunta)
        rel.chamadas_llm += 1
        rel.leitura = plano.get("leitura", "")

        if not plano.get("viavel"):
            rel.recusa = plano.get("recusa") or "A base não permite esta investigação."
            rel.segundos = time.perf_counter() - t0
            yield {"type": "phase", "phase": "planejar", "state": "recusado"}
            yield {"type": "refused", "reason": rel.recusa}
            return

        etapas = [Etapa.de_dict(e, "plano") for e in plano.get("etapas", [])][: self.max_etapas]
        yield {
            "type": "phase",
            "phase": "planejar",
            "state": "concluido",
            "reading": rel.leitura,
            "steps": [{"question": e.pergunta, "purpose": e.proposito} for e in etapas],
        }

        yield from self._executa(etapas, rel)
        yield from self._reflete(pergunta, rel)

        yield {"type": "phase", "phase": "sintetizar", "state": "ativo"}
        rel.texto = report.sintetizar(pergunta, rel.leitura, rel.achados, rel.lacuna)
        rel.chamadas_llm += 1
        rel.segundos = time.perf_counter() - t0
        yield {"type": "phase", "phase": "sintetizar", "state": "concluido"}

    def _executa(self, etapas: list[Etapa], rel: Relatorio) -> Iterator[dict]:
        if not etapas:
            return
        fase = "executar" if etapas[0].origem == "plano" else "aprofundar"
        yield {"type": "phase", "phase": fase, "state": "ativo", "total": len(etapas)}
        achados = self.executor.lote(etapas)
        # Uma geração de SQL por etapa, no mínimo; reparos e a extração da
        # definição somam mais, então este número é um piso.
        rel.chamadas_llm += len(etapas)
        rel.achados.extend(achados)
        for a in achados:
            yield {"type": "block", "block": report.bloco_para_json(a)}
        yield {
            "type": "phase",
            "phase": fase,
            "state": "concluido",
            "ok": sum(1 for a in achados if a.ok),
            "total": len(achados),
        }

    def _reflete(self, pergunta: str, rel: Relatorio) -> Iterator[dict]:
        restante = min(MAX_ETAPAS_REFLEXAO, self.max_etapas - len(rel.achados))
        if restante <= 0 or not rel.achados:
            return

        yield {"type": "phase", "phase": "refletir", "state": "ativo"}
        reflexao = phases.refletir(pergunta, rel.achados, restante)
        rel.chamadas_llm += 1

        if reflexao.suficiente or not reflexao.etapas_extras:
            yield {"type": "phase", "phase": "refletir", "state": "concluido", "extra": 0}
            return

        rel.lacuna = reflexao.observacao
        rel.defeitos = reflexao.defeitos
        yield {
            "type": "phase",
            "phase": "refletir",
            "state": "concluido",
            "extra": len(reflexao.etapas_extras),
            "gap": rel.lacuna,
            "defects": reflexao.defeitos,
        }

        antes = len(rel.achados)
        yield from self._executa(reflexao.etapas_extras, rel)
        # A lacuna só continua aberta se as etapas extras também falharam.
        if any(a.ok for a in rel.achados[antes:]):
            rel.lacuna = ""


def _cli() -> None:
    import json
    import sys

    pergunta = " ".join(sys.argv[1:]) or "Existe relação entre câncer e idade?"
    rel = Investigador().investigar(pergunta)
    print(json.dumps(report.para_json(rel), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    _cli()
