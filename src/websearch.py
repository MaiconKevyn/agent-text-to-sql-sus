"""Busca web restrita a fontes confiáveis, via Tavily.

Serve um problema concreto que o produto tem hoje e não sabe resolver: quando um
número parece estranho — a linha de câncer despencando em 2015, COVID dando zero
em U07, São Paulo com 88 mil internações — a pergunta seguinte é sempre "isso é
real ou é defeito do dado?". A resposta mora em nota técnica do DATASUS, portaria
do Ministério, artigo do SciELO. Esta camada busca lá.

Três regras que definem o desenho:

  LISTA BRANCA. Sem ela, é "o modelo leu algo na internet". Com ela, é uma camada
  de citação: um relatório que cita nota técnica do DATASUS ao lado de um número
  do DuckDB é defensável; um que cita um blog não é.

  DEVOLVE CANDIDATOS, NÃO RESPOSTAS. A busca não fixa nada. Ela traz opções, o
  usuário escolhe, e o escolhido preenche o mesmo formulário de fonte externa
  que já existe. É o padrão de propor-e-confirmar que já vale para a definição
  de termos e para o plano de investigação.

  O CONTEÚDO NUNCA VIRA CONSULTA. Nada daqui entra no prompt que gera SQL — a
  barreira está em themes/contexto.py. Uma página é conteúdo de terceiro, e uma
  página que diga "ignore as instruções anteriores" é uma instrução chegando pelo
  canal dos dados. A lista branca reduz muito essa superfície; a barreira a
  fecha.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import httpx

from .config import settings

TAVILY_URL = "https://api.tavily.com/search"

# Domínios que podem embasar uma afirmação num relatório de saúde pública
# brasileiro. Configurável por SEARCH_DOMAINS no .env, e visível na interface:
# quem acrescenta um domínio tem de saber o que está fazendo.
DOMINIOS_PADRAO = (
    "datasus.saude.gov.br",
    "saude.gov.br",
    "gov.br",
    "ibge.gov.br",
    "fiocruz.br",
    "scielo.br",
    "scielo.org",
    "pubmed.ncbi.nlm.nih.gov",
    "who.int",
    "paho.org",
)

MAX_RESULTADOS = 6
# O trecho que vai para a tela. Curto o bastante para ser lido antes de escolher,
# longo o bastante para a escolha não ser um chute.
MAX_TRECHO = 900
TIMEOUT_S = 20.0


class BuscaIndisponivel(RuntimeError):
    """Sem chave, sem rede, ou a Tavily recusou. Nunca deve derrubar a tela."""


@dataclass
class Candidato:
    titulo: str
    url: str
    trecho: str
    dominio: str
    publicado_em: str = ""
    # Relevância que a Tavily atribuiu. Serve para ordenar, não para decidir.
    escore: float = 0.0

    def para_json(self) -> dict:
        return {
            "title": self.titulo,
            "url": self.url,
            "excerpt": self.trecho,
            "domain": self.dominio,
            "publishedAt": self.publicado_em,
            "score": round(self.escore, 3),
        }


@dataclass
class Resultado:
    consulta: str
    candidatos: list[Candidato] = field(default_factory=list)
    dominios: list[str] = field(default_factory=list)

    def para_json(self) -> dict:
        return {
            "query": self.consulta,
            "domains": self.dominios,
            "candidates": [c.para_json() for c in self.candidatos],
        }


def dominios_ativos() -> list[str]:
    bruto = os.getenv("SEARCH_DOMAINS", "").strip()
    if not bruto:
        return list(DOMINIOS_PADRAO)
    return [d.strip().lower() for d in bruto.split(",") if d.strip()]


def _dominio(url: str) -> str:
    from urllib.parse import urlparse

    return urlparse(url).hostname.removeprefix("www.") if urlparse(url).hostname else ""


def _permitido(url: str, dominios: list[str]) -> bool:
    """Confere o domínio DEPOIS da resposta, não só no pedido.

    A Tavily aceita `include_domains`, mas confiar só nisso deixaria a garantia
    do lado de fora: um redirecionamento ou uma mudança na API bastaria para
    entrar conteúdo de qualquer lugar. A lista branca é conferida aqui.
    """
    host = _dominio(url)
    return bool(host) and any(host == d or host.endswith("." + d) for d in dominios)


def buscar(consulta: str, *, max_resultados: int = MAX_RESULTADOS) -> Resultado:
    """Busca nos domínios permitidos e devolve candidatos para escolha humana."""
    chave = os.getenv("TAVILY_API_KEY", "").strip()
    if not chave:
        raise BuscaIndisponivel("TAVILY_API_KEY não configurada no .env")

    dominios = dominios_ativos()
    corpo = {
        "api_key": chave,
        "query": consulta,
        "search_depth": "advanced",
        "max_results": max_resultados,
        "include_domains": dominios,
        # Sem `include_answer`: uma resposta sintetizada pela Tavily seria um
        # texto sem fonte única, impossível de citar. O que serve aqui é o
        # trecho da página, atribuível.
        "include_answer": False,
        "include_raw_content": False,
    }

    try:
        with httpx.Client(timeout=TIMEOUT_S) as cliente:
            resp = cliente.post(TAVILY_URL, json=corpo)
        resp.raise_for_status()
        dados = resp.json()
    except httpx.HTTPStatusError as exc:
        raise BuscaIndisponivel(f"A Tavily recusou (HTTP {exc.response.status_code})") from exc
    except httpx.HTTPError as exc:
        raise BuscaIndisponivel(f"Falha de rede na busca: {exc}") from exc
    except ValueError as exc:
        raise BuscaIndisponivel("A Tavily devolveu algo que não é JSON") from exc

    candidatos: list[Candidato] = []
    for item in dados.get("results") or []:
        url = str(item.get("url") or "")
        if not _permitido(url, dominios):
            continue
        trecho = " ".join(str(item.get("content") or "").split())
        candidatos.append(
            Candidato(
                titulo=" ".join(str(item.get("title") or "").split())[:180],
                url=url,
                trecho=trecho[:MAX_TRECHO],
                dominio=_dominio(url),
                publicado_em=str(item.get("published_date") or ""),
                escore=float(item.get("score") or 0.0),
            )
        )

    candidatos.sort(key=lambda c: c.escore, reverse=True)
    return Resultado(consulta=consulta, candidatos=candidatos, dominios=dominios)


def disponivel() -> bool:
    """Se a interface deve oferecer a busca. Não faz chamada de rede."""
    return bool(os.getenv("TAVILY_API_KEY", "").strip())
