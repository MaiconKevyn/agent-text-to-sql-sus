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

# O QUE O ACHADO FAZ no argumento do tema.
#
# String vazia é "ainda não classificado", e é o padrão — de propósito. Um
# achado nasce no gesto de fixar uma resposta, e obrigar a classificar naquele
# momento transformaria um gesto de um clique numa decisão. O que a tela faz é
# mostrar que falta, não impedir que exista.
#
# Não há valor "neutro" fora do vazio: se alguém escolheu "contextualiza", isso
# é uma afirmação sobre o papel do achado, diferente de nunca ter olhado.
Papel = Literal["", "sustenta", "contradiz", "contextualiza"]

# Se o achado é carga ou acabamento. Só o material entra na conta de apoio de
# uma resposta — "esta conclusão se apoia em dois achados materiais" só
# significa alguma coisa se secundário significar "se cair, nada muda".
Peso = Literal["material", "secundario"]

PAPEIS: tuple[str, ...] = ("", "sustenta", "contradiz", "contextualiza")
PESOS: tuple[str, ...] = ("material", "secundario")

# COMO o bloco se apresenta no painel. Separado de `tipo` porque são perguntas
# diferentes: `tipo` é de onde veio, `formato` é o que o leitor vê. A mesma
# consulta que devolve uma linha pode ser um número grande ou uma tabela.
# `auto` deixa a interface escolher pelo formato do resultado.
Formato = Literal["auto", "indicador", "grafico", "tabela", "citacao"]

# Quanto o bloco ocupa na grade do painel: colunas de 1 a COLUNAS, e altura em
# unidades de linha. Nasceu como três tamanhos fixos (p/m/g) e virou isto quando
# ficou claro que o gesto natural é pegar a borda e puxar — três degraus não
# respondem a "um pouco mais largo".
COLUNAS = 12
LARGURA_MIN, ALTURA_MIN = 3, 4
ALTURA_MAX = 40

# Como os tamanhos antigos entram no novo eixo. Sem isto, todo tema já salvo
# perderia o arranjo na primeira leitura.
LARGURA_LEGADA = {"p": 4, "m": 8, "g": 12}


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:12]}"


def _largura_de(d: dict) -> int:
    """Largura em colunas, aceitando o `size` p/m/g dos temas salvos antes."""
    bruto = d.get("width")
    if bruto is None:
        bruto = LARGURA_LEGADA.get(str(d.get("size") or ""), 4)
    return max(LARGURA_MIN, min(COLUNAS, int(bruto)))


def acomodar(blocos: list[Bloco]) -> None:
    """Dá posição a quem ainda não tem, sem mexer em quem já tem.

    É o que faz um bloco recém-fixado aparecer num lugar razoável, e o que
    converte os temas salvos antes de existir posição — lá a ordem da lista era
    o arranjo, então percorrê-la enfileirando reproduz o que a pessoa via.

    Enfileira da esquerda para a direita e desce quando não cabe mais na linha,
    procurando o primeiro `y` livre. Ineficiente por natureza (varre todos os
    colocados a cada tentativa) e isso não importa: um tema tem dezenas de
    blocos, não milhares.
    """
    colocados = [b for b in blocos if b.x >= 0 and b.y >= 0]

    def livre(x: int, y: int, w: int, h: int) -> bool:
        return not any(
            x < b.x + b.largura and x + w > b.x and y < b.y + b.altura and y + h > b.y
            for b in colocados
        )

    for bloco in blocos:
        if bloco.x >= 0 and bloco.y >= 0:
            continue
        largura = min(bloco.largura, COLUNAS)
        y = 0
        while True:
            for x in range(0, COLUNAS - largura + 1):
                if livre(x, y, largura, bloco.altura):
                    bloco.x, bloco.y = x, y
                    colocados.append(bloco)
                    break
            if bloco.x >= 0:
                break
            y += 1


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
class Fio:
    """Uma linha de investigação dentro do tema.

    É a camada que faltava entre o tema e o achado. Um tema com dez achados é um
    mosaico plano: não dá para saber quais deles respondem a mesma sub-pergunta,
    e a ordem na tela é o arranjo, não o argumento.

    Não tem "tipo" (monitoramento × inquérito, como nas referências): monitorar
    não significa nada numa base fechada em 2023, e um campo que não significa
    nada é pior que campo nenhum — ele convida a preencher.
    """

    id: str = field(default_factory=lambda: _id("fio"))
    titulo: str = ""
    resumo: str = ""
    ordem: int = 0
    criado_em: str = field(default_factory=_agora)

    def para_json(self) -> dict:
        return {
            "id": self.id,
            "title": self.titulo,
            "summary": self.resumo,
            "order": self.ordem,
            "createdAt": self.criado_em,
        }

    @classmethod
    def de_json(cls, d: dict) -> Fio:
        return cls(
            id=str(d.get("id") or _id("fio")),
            titulo=str(d.get("title") or ""),
            resumo=str(d.get("summary") or ""),
            ordem=int(d.get("order") or 0),
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
    # O papel no argumento, o peso, e a relevância dita em uma frase.
    #
    # `porque` é separado de `anotacao` de propósito, e a diferença não é
    # estilística: anotação é rascunho de quem investiga — pode ser "conferir
    # isso depois" —, enquanto `porque` é a frase que explica por que o achado
    # sustenta ou derruba alguma coisa, e é ela que vai para o relatório.
    papel: Papel = ""
    peso: Peso = "secundario"
    porque: str = ""
    # A que linha de investigação este achado pertence. Vazio = solto no quadro,
    # que é como todo achado já salvo vai nascer e como um tema pequeno fica
    # para sempre, se ninguém precisar de fios.
    fio_id: str = ""
    # De onde veio, quando a procedência não é o banco. `url` e `acessado_em`
    # são o que torna a citação conferível: sem eles, o trecho é só um texto que
    # alguém colou, indistinguível de uma lembrança.
    fonte_url: str = ""
    fonte_titulo: str = ""
    acessado_em: str = ""
    # Apresentação. Nasce num tamanho médio e só muda se alguém ajustar — quem
    # fixa um bloco não deveria precisar decidir o arranjo no mesmo gesto.
    formato: Formato = "auto"
    largura: int = 4
    altura: int = 8
    # Posição na grade, em células. -1 significa "ainda não colocado": o tema
    # acomoda na leitura. Guardar a posição, e não deduzi-la da ordem da lista,
    # é o que permite deixar um bloco onde ele foi solto — inclusive ao lado de
    # outro, com espaço vazio embaixo.
    x: int = -1
    y: int = -1
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
            "role": self.papel,
            "thread": self.fio_id,
            "weight": self.peso,
            "why": self.porque,
            "sourceUrl": self.fonte_url,
            "sourceTitle": self.fonte_titulo,
            "accessedAt": self.acessado_em,
            "format": self.formato,
            "width": self.largura,
            "height": self.altura,
            "x": self.x,
            "y": self.y,
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
            # Achado salvo antes destes campos abre como "não classificado", que
            # é exatamente o que ele é. Nada de inferir papel a partir do texto.
            papel=d.get("role") if d.get("role") in PAPEIS else "",
            fio_id=str(d.get("thread") or ""),
            peso=d.get("weight") if d.get("weight") in PESOS else "secundario",
            porque=str(d.get("why") or ""),
            fonte_url=str(d.get("sourceUrl") or ""),
            fonte_titulo=str(d.get("sourceTitle") or ""),
            acessado_em=str(d.get("accessedAt") or ""),
            formato=d.get("format") or "auto",
            largura=_largura_de(d),
            altura=max(ALTURA_MIN, min(ALTURA_MAX, int(d.get("height") or 8))),
            x=int(d.get("x", -1)),
            y=int(d.get("y", -1)),
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
    # Paleta própria deste tema. Vazio = usa a escolhida no site. Fica no tema e
    # não no navegador de propósito: o tema é compartilhável por URL, e a
    # aparência faz parte de como a investigação foi montada.
    paleta: str = ""
    definicoes: list[Definicao] = field(default_factory=list)
    fios: list[Fio] = field(default_factory=list)
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
            "palette": self.paleta,
            "definitions": [d.para_json() for d in self.definicoes],
            "threads": [f.para_json() for f in sorted(self.fios, key=lambda f: f.ordem)],
            "blockCount": len(self.blocos),
            # As duas contagens que a lista de temas mostra. Vão no payload SEM
            # blocos de propósito: é justamente a lista que precisa delas, e ela
            # não carrega os blocos para não trazer resultado inteiro de vinte
            # consultas só para desenhar vinte linhas.
            "contradictions": sum(1 for b in self.blocos if b.papel == "contradiz"),
            "unclassified": sum(1 for b in self.blocos if not b.papel),
        }
        if com_blocos:
            base["blocks"] = [b.para_json() for b in self.blocos]
        return base

    @classmethod
    def de_json(cls, d: dict) -> Tema:
        blocos = [Bloco.de_json(x) for x in (d.get("blocks") or [])]
        # Na leitura, e não na escrita: assim um tema salvo antes de existir
        # posição ganha a sua na primeira vez que é aberto, sem migração.
        acomodar(blocos)
        return cls(
            id=str(d.get("id") or _id("tema")),
            titulo=str(d.get("title") or "Nova investigação"),
            descricao=str(d.get("description") or ""),
            criado_em=str(d.get("createdAt") or _agora()),
            atualizado_em=str(d.get("updatedAt") or _agora()),
            paleta=str(d.get("palette") or ""),
            definicoes=[Definicao.de_json(x) for x in (d.get("definitions") or [])],
            fios=[Fio.de_json(x) for x in (d.get("threads") or [])],
            blocos=blocos,
        )
