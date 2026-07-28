"""Um pedido de análise vira um plano; o plano vira uma fila de pedidos.

"Crie uma análise completa sobre óbitos de covid" não é um widget nem um filtro.
É uma dúzia deles, e escolher QUAIS é o trabalho — um painel com seis gráficos
sobre a mesma coisa vista de seis ângulos diferentes responde; seis gráficos
escolhidos ao acaso só ocupam a tela.

O planejador é a única chamada de modelo do projeto que roda em esforço alto, e
a razão é a assimetria: ele custa uma chamada e decide o conteúdo de doze. Errar
o plano custa doze consultas de 144 milhões de linhas que ninguém pediu.

A REGRA QUE FAZ ISSO FUNCIONAR é que cada item do plano é uma FRASE COMPLETA. Os
itens são executados depois, um por um, cada um numa chamada que não viu o
plano, não viu a pergunta original e não verá os outros itens. "Óbitos por ano"
dentro de um plano sobre COVID vira, na execução, óbitos por ano de tudo — e o
painel mostra um número quinze vezes maior sem nunca dar erro. Por isso o
esquema exige o assunto repetido em cada pedido, e o código confere.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..config import settings
from ..llm import carrega as llm_carrega, complete, complete_json_streaming
from ..schema_context import build_schema_prompt, load_schema
from . import progresso as prog

_REGRAS = len(load_schema().get("rules") or [])

# Um plano maior que isto não cabe na tela nem na cabeça de quem lê. Doze itens
# já são quatro indicadores, cinco gráficos e três filtros.
MAX_ITENS = 12

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["possivel", "titulo", "raciocinio", "itens", "recusa"],
    "properties": {
        "possivel": {
            "type": "boolean",
            "description": "false se a base não sustenta a análise pedida.",
        },
        "titulo": {
            "type": "string",
            "description": "Título do painel. Curto e específico: 'COVID-19 no SUS (2020-2023)'.",
        },
        "raciocinio": {
            "type": "string",
            "description": (
                "Dois a quatro períodos CORRIDOS, em português, no máximo 700 caracteres: "
                "o que a base permite ver sobre esse assunto, o que ela NÃO permite, e por "
                "que estes recortes e não outros. Sem lista, sem título, sem marcador — é "
                "um parágrafo que a pessoa lê de uma vez para saber se o plano faz sentido."
            ),
        },
        "itens": {
            "type": "array",
            "maxItems": MAX_ITENS,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["tipo", "pedido", "porque"],
                "properties": {
                    "tipo": {"type": "string", "enum": ["indicador", "grafico", "filtro"]},
                    "pedido": {
                        "type": "string",
                        "maxLength": 160,
                        "description": (
                            "UMA frase em português corrente, como alguém pediria em voz alta, "
                            "com o assunto por extenso. Sem SQL e sem nome de coluna. "
                            "Ex.: 'óbitos por COVID-19 a cada mês' — não "
                            "'COUNT(*) FILTER (WHERE MORTE) com DIAG_PRINC = B342 por mês'."
                        ),
                    },
                    "porque": {
                        "type": "string",
                        "description": "Meia frase: o que este item acrescenta ao painel.",
                    },
                },
            },
        },
        "recusa": {"type": "string", "description": "Se possivel=false, o que falta na base."},
    },
}

SISTEMA = """Você planeja um PAINEL ANALÍTICO sobre internações do SUS. Recebe um \
assunto e devolve a lista de mostradores que respondem a ele.

{schema}

## CADA ITEM É EXECUTADO SOZINHO

Isto é o mais importante deste trabalho. Cada `pedido` vai para uma chamada \
separada, que NÃO vê este plano, NÃO vê o assunto original e NÃO vê os outros \
itens. Ela recebe só aquela frase.

Então "óbitos por ano" num plano sobre COVID produz os óbitos de TUDO — um \
número quinze vezes maior, num gráfico com o título certo. Ninguém percebe.

Escreva cada pedido como se fosse a única coisa que alguém vai ler:

  RUIM   "óbitos por ano"
  BOM    "óbitos por COVID-19 por ano"

  RUIM   "internações por UF"
  BOM    "ranking de internações por COVID-19 por UF de residência"

## UMA FRASE, EM PORTUGUÊS, SEM SQL

Quem executa o pedido recebe o mesmo dicionário do banco que você e escreve a \
consulta melhor do que você escreveria aqui. Ele precisa saber O QUE, não COMO.

  RUIM   "COUNT(*) FILTER (WHERE MORTE) com DIAG_PRINC = 'B342' agrupado por
          year(DT_SAIDA), HAVING COUNT(*) >= 100"
  BOM    "óbitos por COVID-19 a cada ano"

Nada de WHERE, HAVING, JOIN, GROUP BY nem nome de coluna. Um código só entra \
quando desambigua de verdade — "COVID-19" já basta, e quem executa sabe que \
nesta base isso é B342.

## UM INDICADOR É UM NÚMERO

Um indicador mostra UM número grande, e só. "Total de internações, total de \
óbitos, taxa de mortalidade e gasto" não é um indicador: são quatro, e pedidos \
juntos viram um widget que mostra o primeiro e esconde os outros três.

Um gráfico também tem UMA medida e UM eixo de categoria — mais uma série, \
quando faz sentido separar. "Contagem, óbitos e taxa no mesmo gráfico" são três \
gráficos ou um gráfico com uma escolha; escolha.

## NÃO EMBUTA PERÍODO NOS PEDIDOS

O recorte de tempo é trabalho do filtro, e ele vale para o painel inteiro de uma \
vez. Um pedido que já traz "de 2020 a 2023" congela aquele widget: o filtro de \
período passa a mexer nos outros e não nele, e quem olha conclui que os números \
não mudaram por causa do dado. Peça a série inteira; deixe o corte para o filtro.

A exceção é quando o período É o assunto ("internações durante a pandemia").

## O ORÇAMENTO

Doze itens no máximo, repartidos assim:

  2 a 4 INDICADORES — os números de cabeçalho
  4 a 6 GRÁFICOS    — o assunto por ângulos diferentes
  1 a 3 FILTROS     — o que dá para mexer

Um plano sem filtro nenhum não é um painel: é uma folha de gráficos. O filtro é \
o que faz alguém olhar duas vezes para a mesma tela. Gastar as doze vagas em \
leitura entrega um painel que não responde a mais nenhuma pergunta além das que \
você já escolheu.

## NÃO PLANEJE O QUE VOCÊ MESMO DESMENTIU

Se o seu `raciocinio` diz que uma coluna não cobre o período do assunto, ou que \
a base não tem aquele dado, não peça um item que dependa dele. Ele vai voltar \
vazio ou recusado, e terá ocupado uma vaga que faltou para outro.

## O QUE É UMA ANÁLISE COMPLETA

Não é "muitos gráficos". É o assunto visto pelos eixos que a base sustenta:

  TAMANHO — dois a quatro indicadores, UM NÚMERO CADA: o total, os óbitos, a \
taxa de mortalidade, o gasto. São o que a pessoa lê primeiro.
  TEMPO — como isso evoluiu. Quase sempre vale a pena.
  GEOGRAFIA — por UF ou região, lembrando que é a RESIDÊNCIA do paciente.
  QUEM — sexo, faixa etária, raça/cor quando for pertinente ao assunto.
  GRAVIDADE — UTI, permanência, letalidade por grupo.
  CAUSA — quando o assunto for um desfecho e não um diagnóstico ("mortes por \
AVC" pede o ranking dos diagnósticos; "internações por COVID" não pede).

Nem todo assunto pede todos. Um assunto restrito a um diagnóstico não precisa \
de um gráfico de diagnósticos.

## FILTROS

De um a três, e só os que fazem sentido MEXER neste painel: período, UF, sexo, \
faixa etária. Um filtro pelo próprio assunto ("filtro por diagnóstico" num \
painel de COVID) é inútil — o painel inteiro já é aquele diagnóstico.

O pedido de um filtro nomeia o CONTROLE, e nada mais: "filtro por ano", "filtro \
por UF de residência", "filtro por sexo, podendo marcar os dois". Não diga qual \
valor ele deve trazer selecionado — um filtro nasce sem recortar nada, de \
propósito, para o painel não abrir já escondendo metade dos dados.

## RECUSE QUANDO A BASE NÃO SUSTENTA

Não há nome de hospital, não há população (então não há taxa por 100 mil \
habitantes), não há custo real, não há desfecho após a alta, não há reinternação \
rastreável por paciente. Se o assunto pedido depende disso, `possivel=false` com \
o motivo — melhor uma frase honesta que doze gráficos que respondem outra \
pergunta.

Se a base sustenta PARTE do assunto, planeje a parte que ela sustenta e diga no \
`raciocinio` o que ficou de fora."""


def _pensar(pedido: str, sistema: str, relatar: prog.Relator) -> dict:
    """A chamada do planejador, relatando o plano conforme ele é escrito.

    Sem relator não há por que abrir o fluxo — a chamada direta é mais simples e
    é o que os testes e a API sem stream usam. Com relator, o mesmo trabalho
    vira uma lista que cresce: o título quando o modelo o escolhe, e cada item
    quando a sua última aspa chega.
    """
    argumentos = dict(
        model=settings.sql_model,
        system=sistema,
        messages=[{"role": "user", "content": f"Assunto da análise: {pedido}"}],
        schema=ESQUEMA,
        schema_name="plano",
        # Alto, e só aqui: uma chamada decide o conteúdo de doze.
        reasoning_effort="high",
    )
    if relatar is None:
        bruto = complete(**argumentos)
        assert isinstance(bruto, dict)
        return bruto

    texto, anunciados, titulo_dito = "", 0, False
    for pedaco in complete_json_streaming(**argumentos):
        texto += pedaco
        if not titulo_dito and (m := _TITULO_PRONTO.search(texto)):
            prog.fecha(
                relatar,
                "pensar",
                "Decidindo o que a base sustenta sobre o assunto",
                m.group(1)[:70],
            )
            prog.relata(relatar, "montar", "Escolhendo os mostradores")
            titulo_dito = True
        prontos = _PEDIDO_PRONTO.findall(texto)
        while anunciados < len(prontos):
            prog.fecha(relatar, f"item{anunciados}", prontos[anunciados][:110])
            anunciados += 1

    prog.fecha(
        relatar,
        "montar",
        "Escolhendo os mostradores",
        f"{anunciados} {'item' if anunciados == 1 else 'itens'}",
    )
    return llm_carrega(texto)


@dataclass
class Item:
    tipo: str
    pedido: str
    porque: str = ""

    def para_json(self) -> dict:
        return {"kind": self.tipo, "request": self.pedido, "why": self.porque}


@dataclass
class Plano:
    titulo: str = ""
    raciocinio: str = ""
    itens: list[Item] = field(default_factory=list)
    recusa: str = ""

    def para_json(self) -> dict:
        return {
            "title": self.titulo,
            "reasoning": self.raciocinio,
            "items": [i.para_json() for i in self.itens],
            "refused": self.recusa,
        }


# Um `pedido` só é anunciado quando a aspa de fechamento chegou — meio pedido na
# tela é pior que nenhum, porque some e reaparece diferente.
_PEDIDO_PRONTO = re.compile(r'"pedido"\s*:\s*"((?:[^"\\]|\\.)*)"')
_TITULO_PRONTO = re.compile(r'"titulo"\s*:\s*"((?:[^"\\]|\\.)*)"')


def planejar(pedido: str, relatar: prog.Relator = None) -> Plano:
    """Lê o assunto, pensa sobre a base, devolve a lista de mostradores."""
    prog.relata(relatar, "dicionario", "Lendo o dicionário do banco")
    sistema = SISTEMA.format(schema=build_schema_prompt())
    prog.fecha(relatar, "dicionario", "Lendo o dicionário do banco", f"{_REGRAS} regras")

    prog.relata(relatar, "pensar", "Decidindo o que a base sustenta sobre o assunto")
    try:
        bruto = _pensar(pedido, sistema, relatar)
    except Exception as exc:  # noqa: BLE001
        prog.relata(
            relatar,
            "pensar",
            "Decidindo o que a base sustenta sobre o assunto",
            prog.FALHOU,
            str(exc)[:60],
        )
        return Plano(recusa=f"O planejamento falhou: {str(exc)[:200]}")
    assert isinstance(bruto, dict)

    if not bruto.get("possivel"):
        return Plano(recusa=str(bruto.get("recusa") or "A base não sustenta essa análise.")[:500])

    itens = [
        Item(
            tipo=x.get("tipo") if x.get("tipo") in ("indicador", "grafico", "filtro") else "grafico",
            pedido=str(x.get("pedido") or "").strip()[:300],
            porque=str(x.get("porque") or "").strip()[:160],
        )
        for x in (bruto.get("itens") or [])
        if isinstance(x, dict) and str(x.get("pedido") or "").strip()
    ][:MAX_ITENS]

    if not itens:
        return Plano(recusa="O plano voltou sem nenhum item.")

    return Plano(
        titulo=str(bruto.get("titulo") or pedido)[:120],
        raciocinio=_ate_o_ponto(str(bruto.get("raciocinio") or ""), 900),
        itens=equilibrar(itens),
    )


def _ate_o_ponto(texto: str, teto: int) -> str:
    """Corta no fim de uma frase, não no meio de uma palavra.

    O raciocínio é justamente onde estão as ressalvas — "o campo X não cobre o
    período Y" —, e uma ressalva cortada ao meio é pior que ressalva nenhuma:
    fica parecendo que o texto ia dizer o contrário.
    """
    t = texto.strip()
    if len(t) <= teto:
        return t
    corte = max(t.rfind(". ", 0, teto), t.rfind("; ", 0, teto))
    return (t[: corte + 1] if corte > teto // 2 else t[:teto].rsplit(" ", 1)[0] + "…").strip()


# Quantos de cada tipo cabem. O prompt pede isto e o código impõe — um modelo
# que gasta as doze vagas em indicadores devolve um painel sem nada para mexer,
# e "peça de novo" não é conserto.
TETO_POR_TIPO = {"indicador": 4, "grafico": 6, "filtro": 3}


def equilibrar(itens: list[Item]) -> list[Item]:
    """Corta o excesso de cada tipo e ordena: indicadores, gráficos, filtros.

    O CORTE vem do que um painel comporta. Seis indicadores são seis números
    grandes ocupando a primeira tela inteira, e a partir do quarto ninguém os
    lê como cabeçalho — lê como lista. O que sobra da vaga vai para gráfico ou
    filtro, que é onde uma análise responde alguma coisa.

    A ORDEM vem de como a fila executa: por chegada, três de cada vez. Os
    indicadores são as consultas mais baratas e os números que a pessoa lê
    primeiro, então vão na frente e a tela diz algo em vinte segundos. Os
    filtros vão por último porque são os únicos que leem o catálogo de widgets
    do painel, e ele só está completo quando os widgets existem.
    """
    peso = {"indicador": 0, "grafico": 1, "filtro": 2}
    quantos: dict[str, int] = {}
    mantidos: list[Item] = []
    for item in itens:
        n = quantos.get(item.tipo, 0)
        if n >= TETO_POR_TIPO.get(item.tipo, 6):
            continue
        quantos[item.tipo] = n + 1
        mantidos.append(item)
    return sorted(mantidos, key=lambda i: peso.get(i.tipo, 1))
