"""Tipos do domínio da investigação. Sem I/O, sem LLM — só forma dos dados."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..db import QueryResult

# De onde veio a etapa. A distinção aparece no relatório: uma etapa de reflexão
# existe porque o argumento tinha um buraco, e o leitor merece saber disso.
Origem = str  # "plano" | "reflexao"


@dataclass(frozen=True)
class Etapa:
    """Uma pergunta a executar, com o papel que ela cumpre no argumento."""

    pergunta: str
    proposito: str
    origem: Origem = "plano"

    @classmethod
    def de_dict(cls, bruto: dict, origem: Origem) -> Etapa:
        return cls(
            pergunta=str(bruto.get("pergunta", "")).strip(),
            proposito=str(bruto.get("proposito", "")).strip(),
            origem=origem,
        )


@dataclass
class Achado:
    """Uma etapa executada, com o que ela produziu — ou por que não produziu."""

    etapa: Etapa
    sql: str | None = None
    resultado: QueryResult | None = None
    chart: dict | None = None
    erro: str | None = None
    # Como o agente definiu os termos: o recorte que ele escolheu para "câncer",
    # "idoso", "óbito". Sem isso o número está certo e o rótulo está errado.
    definicao: str = ""
    suposicoes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.resultado is not None

    @property
    def pergunta(self) -> str:
        return self.etapa.pergunta

    def para_prompt(self, max_linhas: int = 12) -> str:
        """Como esta evidência é apresentada ao modelo nas fases seguintes."""
        from ..agent import _format_rows

        cabeca = f"### {self.etapa.pergunta}\n(propósito: {self.etapa.proposito})"
        if not self.ok or self.resultado is None:
            return f"{cabeca}\nFALHOU: {self.erro or 'sem resultado'}"
        corpo = _format_rows(self.resultado, max_linhas)
        if self.definicao:
            corpo = f"Definição usada: {self.definicao}\n{corpo}"
        return f"{cabeca}\n{corpo}"


@dataclass
class Relatorio:
    """O produto da investigação: as evidências, o texto e o que ficou em aberto."""

    pergunta: str
    leitura: str = ""
    achados: list[Achado] = field(default_factory=list)
    texto: str = ""
    lacuna: str = ""
    recusa: str = ""
    segundos: float = 0.0
    chamadas_llm: int = 0
    # Quais defeitos a reflexão apontou. Aparece no relatório: o leitor merece
    # saber que uma etapa existe porque o argumento tinha um buraco.
    defeitos: list[str] = field(default_factory=list)

    @property
    def etapas_ok(self) -> int:
        return sum(1 for a in self.achados if a.ok)

    @property
    def etapas_de_reflexao(self) -> int:
        return sum(1 for a in self.achados if a.etapa.origem == "reflexao")

    @property
    def falhou_tudo(self) -> bool:
        return bool(self.achados) and self.etapas_ok == 0


@dataclass(frozen=True)
class Reflexao:
    """O diagnóstico da fase de reflexão, com a decisão DERIVADA dele.

    O modelo responde cinco perguntas objetivas; `suficiente` é calculado aqui.
    Na versão anterior ele afirmava `suficiente` num campo e descrevia o buraco
    noutro, e usou essa liberdade para dizer "são contagens brutas, o que não
    sustenta a comparação" e marcar suficiente=true na mesma resposta.
    """

    diagnostico: dict[str, bool]
    observacao: str
    etapas_extras: list[Etapa]

    @property
    def defeitos(self) -> list[str]:
        return [nome for nome, presente in self.diagnostico.items() if presente]

    @property
    def suficiente(self) -> bool:
        return not self.defeitos

    @classmethod
    def de_dict(cls, bruto: dict, limite: int) -> Reflexao:
        from .contracts import DEFEITOS

        diag = bruto.get("diagnostico") or {}
        diagnostico = {nome: bool(diag.get(nome)) for nome in DEFEITOS}
        marcados = sum(diagnostico.values())
        # Uma etapa por defeito: sem esse corte o modelo pede três consultas
        # para um problema só e o orçamento evapora.
        teto = min(limite, marcados)
        etapas = [
            Etapa.de_dict(e, "reflexao") for e in (bruto.get("etapas_extras") or [])[:teto]
        ]
        return cls(
            diagnostico=diagnostico,
            observacao=str(bruto.get("observacao") or "").strip(),
            etapas_extras=etapas,
        )
