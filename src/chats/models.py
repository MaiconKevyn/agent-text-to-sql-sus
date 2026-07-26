"""Uma conversa salva.

Chat e tema guardam coisas parecidas e servem a propósitos opostos:

  O CHAT É RASCUNHO. Salvo para você poder voltar, não para acumular. Fechar a
  aba sem querer deixou de custar a conversa — só isso.

  O TEMA É ARTEFATO. Acumula, tem anotação, tem definição própria e vira
  contexto das perguntas seguintes.

Por isso a conversa salva NÃO vira contexto de outra conversa. Essa propriedade
é do tema, e é o que o torna diferente de uma pasta de rascunhos.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Rodada:
    """Uma pergunta e o que ela produziu."""

    pergunta: str
    texto: str = ""
    sql: str | None = None
    resultado: dict | None = None
    chart: dict | None = None
    suposicoes: list[str] = field(default_factory=list)
    continuidade: dict | None = None
    em: str = field(default_factory=_agora)

    def para_json(self) -> dict:
        return {
            "question": self.pergunta,
            "text": self.texto,
            "sql": self.sql,
            "result": self.resultado,
            "chart": self.chart,
            "assumptions": self.suposicoes,
            "continuity": self.continuidade,
            "at": self.em,
        }

    @classmethod
    def de_json(cls, d: dict) -> Rodada:
        return cls(
            pergunta=str(d.get("question") or ""),
            texto=str(d.get("text") or ""),
            sql=d.get("sql"),
            resultado=d.get("result"),
            chart=d.get("chart"),
            suposicoes=list(d.get("assumptions") or []),
            continuidade=d.get("continuity"),
            em=str(d.get("at") or _agora()),
        )


# Um título longo não cabe na lista lateral e um curto demais não identifica.
MAX_TITULO = 70


@dataclass
class Chat:
    id: str = field(default_factory=lambda: f"chat_{uuid.uuid4().hex[:12]}")
    titulo: str = ""
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)
    rodadas: list[Rodada] = field(default_factory=list)

    def toca(self) -> None:
        self.atualizado_em = _agora()

    def acrescenta(self, rodada: Rodada) -> None:
        self.rodadas.append(rodada)
        # O título sai da PRIMEIRA pergunta. "Conversa de 25/07 23:41" não é
        # encontrável seis dias depois; "Quantas mortes por covid?" é. E sai
        # daqui, não de uma chamada ao modelo: titular custaria uma chamada por
        # conversa para resolver o que a primeira frase já resolve.
        if not self.titulo and rodada.pergunta:
            t = " ".join(rodada.pergunta.split())
            self.titulo = t[: MAX_TITULO - 1] + "…" if len(t) > MAX_TITULO else t
        self.toca()

    def para_json(self, *, com_rodadas: bool = True) -> dict:
        base = {
            "id": self.id,
            # Sem `or "Sem título"`: este método É o formato de armazenamento, e
            # um padrão de EXIBIÇÃO gravado no disco envenena a ida e volta —
            # na releitura o título deixa de estar vazio, e a primeira pergunta
            # nunca chega a nomear a conversa. Quem exibe é que decide o rótulo
            # do vazio.
            "title": self.titulo,
            "createdAt": self.criado_em,
            "updatedAt": self.atualizado_em,
            "turnCount": len(self.rodadas),
        }
        if com_rodadas:
            base["turns"] = [r.para_json() for r in self.rodadas]
        return base

    @classmethod
    def de_json(cls, d: dict) -> Chat:
        return cls(
            id=str(d.get("id") or f"chat_{uuid.uuid4().hex[:12]}"),
            titulo=str(d.get("title") or ""),
            criado_em=str(d.get("createdAt") or _agora()),
            atualizado_em=str(d.get("updatedAt") or _agora()),
            rodadas=[Rodada.de_json(x) for x in (d.get("turns") or [])],
        )
