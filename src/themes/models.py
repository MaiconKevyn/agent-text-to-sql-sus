"""Tipos do tema de investigação. Sem I/O — só a forma dos dados.

Um TEMA é um espaço de trabalho que acumula evidência sobre um assunto. É o que
o chat não é: o chat é efêmero por natureza e limpar a conversa é uma operação
normal; o tema existe justamente para não perder nada.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

# De onde veio o conteúdo do bloco. Nasce com um valor só, e é de propósito:
# acrescentar o campo depois, quando houver busca web e arquivos anexados, seria
# uma migração de todos os temas já salvos. Aqui custa nada e evita aquilo.
Procedencia = Literal["banco", "web", "arquivo", "usuario"]

# O que o bloco é. `consulta` vem do chat, `investigacao` de um relatório,
# `nota` é texto escrito por quem investiga.
TipoBloco = Literal["consulta", "investigacao", "nota"]

# COMO o bloco se apresenta no painel. Separado de `tipo` porque são perguntas
# diferentes: `tipo` é de onde veio, `formato` é o que o leitor vê. A mesma
# consulta que devolve uma linha pode ser um número grande ou uma tabela.
# `auto` deixa a interface escolher pelo formato do resultado.
Formato = Literal["auto", "indicador", "grafico", "tabela", "citacao"]

# Quanto ocupa numa grade de três colunas. A altura acompanha o conteúdo: uma
# segunda dimensão ajustável dobraria os estados sem dobrar o que se ganha.
Tamanho = Literal["p", "m", "g"]


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:12]}"


@dataclass
class Definicao:
    """Um termo resolvido, válido para o tema inteiro.

    Fica no tema e não no bloco porque é isso que faz a definição valer a pena:
    você confere "covid = 0303010223 + B342 + B972" uma vez, e toda pergunta
    feita dentro do tema herda o mesmo recorte. Sem isso, cada pergunta
    redefine o conceito do zero — que é de onde vêm os erros.
    """

    termo: str
    clausula: str
    codigos: list[dict] = field(default_factory=list)
    total: int = 0
    criado_em: str = field(default_factory=_agora)

    def para_json(self) -> dict:
        return {
            "term": self.termo,
            "clause": self.clausula,
            "codes": self.codigos,
            "total": self.total,
            "createdAt": self.criado_em,
        }

    @classmethod
    def de_json(cls, d: dict) -> Definicao:
        return cls(
            termo=str(d.get("term", "")),
            clausula=str(d.get("clause", "")),
            codigos=list(d.get("codes") or []),
            total=int(d.get("total") or 0),
            criado_em=str(d.get("createdAt") or _agora()),
        )


@dataclass
class Bloco:
    """Uma evidência fixada no tema, com tudo que ela precisa para ser relida.

    Guarda o resultado inteiro, não uma referência: um bloco tem de continuar
    legível daqui a um mês, mesmo que a consulta demore ou que o recorte usado
    tenha mudado desde então.
    """

    id: str = field(default_factory=lambda: _id("blk"))
    tipo: TipoBloco = "consulta"
    procedencia: Procedencia = "banco"
    titulo: str = ""
    pergunta: str = ""
    texto: str = ""
    sql: str | None = None
    resultado: dict | None = None
    chart: dict | None = None
    definicao: str = ""
    suposicoes: list[str] = field(default_factory=list)
    # Anotação de quem investiga. É o que transforma uma coleção de consultas
    # numa investigação: o porquê daquele bloco estar ali.
    anotacao: str = ""
    # De onde veio, quando a procedência não é o banco. `url` e `acessado_em`
    # são o que torna a citação conferível: sem eles, o trecho é só um texto que
    # alguém colou, indistinguível de uma lembrança.
    fonte_url: str = ""
    fonte_titulo: str = ""
    acessado_em: str = ""
    # Apresentação. Nasce em `auto`/`m` e só muda se alguém ajustar — quem fixa
    # um bloco não deveria precisar decidir o arranjo no mesmo gesto.
    formato: Formato = "auto"
    tamanho: Tamanho = "m"
    fixado_em: str = field(default_factory=_agora)

    def para_json(self) -> dict:
        return {
            "id": self.id,
            "kind": self.tipo,
            "provenance": self.procedencia,
            "title": self.titulo,
            "question": self.pergunta,
            "text": self.texto,
            "sql": self.sql,
            "result": self.resultado,
            "chart": self.chart,
            "definition": self.definicao,
            "assumptions": self.suposicoes,
            "note": self.anotacao,
            "sourceUrl": self.fonte_url,
            "sourceTitle": self.fonte_titulo,
            "accessedAt": self.acessado_em,
            "format": self.formato,
            "size": self.tamanho,
            "pinnedAt": self.fixado_em,
        }

    @classmethod
    def de_json(cls, d: dict) -> Bloco:
        return cls(
            id=str(d.get("id") or _id("blk")),
            tipo=d.get("kind") or "consulta",
            procedencia=d.get("provenance") or "banco",
            titulo=str(d.get("title") or ""),
            pergunta=str(d.get("question") or ""),
            texto=str(d.get("text") or ""),
            sql=d.get("sql"),
            resultado=d.get("result"),
            chart=d.get("chart"),
            definicao=str(d.get("definition") or ""),
            suposicoes=list(d.get("assumptions") or []),
            anotacao=str(d.get("note") or ""),
            fonte_url=str(d.get("sourceUrl") or ""),
            fonte_titulo=str(d.get("sourceTitle") or ""),
            acessado_em=str(d.get("accessedAt") or ""),
            formato=d.get("format") or "auto",
            tamanho=d.get("size") or "m",
            fixado_em=str(d.get("pinnedAt") or _agora()),
        )

    def resumo(self, max_linhas: int = 8) -> str:
        """Como este bloco aparece no contexto do chat do tema.

        Compacto de propósito: o tema pode ter vinte blocos, e enfiar vinte
        tabelas inteiras no prompt não deixa espaço para pensar.
        """
        partes = [f"### {self.titulo or self.pergunta}"]
        if self.definicao:
            partes.append(f"Definição: {self.definicao}")
        if self.anotacao:
            partes.append(f"Anotação de quem investiga: {self.anotacao}")

        if self.procedencia != "banco":
            # Só aparece no relatório, nunca na geração de SQL — a barreira está
            # em contexto.py. O trecho vai LITERAL: se o modelo for citar isto,
            # a citação tem de ser conferível contra a fonte.
            origem = self.fonte_url or self.procedencia
            partes.append(f"[fonte externa — {origem}]")
            if self.texto:
                partes.append(f'Trecho citado: "{self.texto[:600]}"')
            return "\n".join(partes)

        res = self.resultado or {}
        colunas = res.get("columns") or []
        linhas = res.get("rows") or []
        if colunas and linhas:
            partes.append(" | ".join(map(str, colunas)))
            for linha in linhas[:max_linhas]:
                partes.append(" | ".join("NULL" if v is None else str(v) for v in linha))
            if len(linhas) > max_linhas:
                partes.append(f"... (+{len(linhas) - max_linhas} linhas)")
        elif self.texto:
            partes.append(self.texto[:400])
        return "\n".join(partes)


@dataclass
class Tema:
    id: str = field(default_factory=lambda: _id("tema"))
    titulo: str = "Nova investigação"
    descricao: str = ""
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)
    definicoes: list[Definicao] = field(default_factory=list)
    blocos: list[Bloco] = field(default_factory=list)

    def toca(self) -> None:
        self.atualizado_em = _agora()

    def bloco(self, id_: str) -> Bloco | None:
        return next((b for b in self.blocos if b.id == id_), None)

    @property
    def clausulas(self) -> str:
        """As definições do tema, prontas para entrar numa pergunta."""
        return " ".join(d.clausula for d in self.definicoes if d.clausula)

    def para_json(self, *, com_blocos: bool = True) -> dict:
        base: dict[str, Any] = {
            "id": self.id,
            "title": self.titulo,
            "description": self.descricao,
            "createdAt": self.criado_em,
            "updatedAt": self.atualizado_em,
            "definitions": [d.para_json() for d in self.definicoes],
            "blockCount": len(self.blocos),
        }
        if com_blocos:
            base["blocks"] = [b.para_json() for b in self.blocos]
        return base

    @classmethod
    def de_json(cls, d: dict) -> Tema:
        return cls(
            id=str(d.get("id") or _id("tema")),
            titulo=str(d.get("title") or "Nova investigação"),
            descricao=str(d.get("description") or ""),
            criado_em=str(d.get("createdAt") or _agora()),
            atualizado_em=str(d.get("updatedAt") or _agora()),
            definicoes=[Definicao.de_json(x) for x in (d.get("definitions") or [])],
            blocos=[Bloco.de_json(x) for x in (d.get("blocks") or [])],
        )
