"""Harness de investigação: várias consultas para uma pergunta só.

O `TextToSQLAgent` faz uma hipótese analítica por pergunta. O laço que ele já
tem (`_execute_with_repair`) é SINTÁTICO: só dispara quando o SQL levanta
exceção. Uma query que roda e devolve a coisa errada passa batido.

Este módulo acrescenta o laço ANALÍTICO, em três fases:

  1. DECOMPOR   — uma chamada transforma a pergunta num plano de etapas, cada
                  uma com um propósito declarado.
  2. EXECUTAR   — cada etapa reusa o agente inteiro (dicionário, value linking,
                  reparo de SQL). As etapas independentes rodam em paralelo.
  3. REFLETIR   — uma chamada olha as evidências e pode ACRESCENTAR etapas. É
                  aqui que "achei contagem bruta onde precisava de proporção"
                  vira uma consulta nova em vez de virar uma conclusão errada.

Por que não um laço ReAct livre, uma query por vez até o modelo dizer "pronto":
cada etapa custa 1–2 chamadas de LLM mais uma varredura em 144 milhões de
linhas. Sem teto, uma investigação vira minutos e dinheiro sem limite superior
conhecido. O plano adiantado dá paralelismo e um custo previsível; a reflexão
devolve a capacidade de reagir à evidência. O orçamento é explícito e checado.
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import time
from dataclasses import dataclass, field
from typing import Any

from .agent import TextToSQLAgent, _clean_sql, _format_rows
from .config import settings
from .db import QueryResult
from .llm import complete
from .value_linker import link_values

# Teto duro. Uma investigação que precisa de mais que isso é uma pergunta que
# deveria ter sido quebrada em duas pelo usuário.
MAX_ETAPAS = 8
MAX_ETAPAS_REFLEXAO = 3


PLANO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["viavel", "leitura", "recusa", "etapas"],
    "properties": {
        "viavel": {
            "type": "boolean",
            "description": "A investigação pode ser feita com as tabelas disponíveis?",
        },
        "leitura": {
            "type": "string",
            "description": (
                "Como você entendeu a pergunta e o que seria preciso para respondê-la "
                "de verdade. Se a base não tem denominador populacional, diga aqui."
            ),
        },
        "recusa": {
            "type": "string",
            "description": "Se viavel=false, o que falta na base. Senão, vazio.",
        },
        "etapas": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["pergunta", "proposito"],
                "properties": {
                    "pergunta": {
                        "type": "string",
                        "description": (
                            "Uma pergunta AUTOCONTIDA, do jeito que um usuário faria. "
                            "Ela vai para o agente de text-to-SQL sozinha, sem o resto "
                            "do plano — então precisa dizer o período, o recorte e a "
                            "métrica por extenso."
                        ),
                    },
                    "proposito": {
                        "type": "string",
                        "description": "Uma frase: que papel esta etapa cumpre no argumento.",
                    },
                },
            },
        },
    },
}

REFLEXAO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["suficiente", "lacuna", "etapas_extras"],
    "properties": {
        "suficiente": {
            "type": "boolean",
            "description": "As evidências já sustentam uma resposta honesta?",
        },
        "lacuna": {
            "type": "string",
            "description": "Se não for suficiente, qual é o buraco no argumento.",
        },
        "etapas_extras": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["pergunta", "proposito"],
                "properties": {
                    "pergunta": {"type": "string"},
                    "proposito": {"type": "string"},
                },
            },
        },
    },
}


PLANO_PROMPT = """\
Você planeja investigações sobre a base do SIH/SUS (internações hospitalares do
DATASUS, 2007-2023, 144 milhões de AIH).

Quebre a pergunta do usuário num plano de 2 a 6 etapas. Cada etapa é UMA
pergunta que será respondida por uma consulta SQL isolada.

O que faz um plano bom:
- COMPARAÇÃO, não contagem solta. "Quantas internações por câncer na faixa
  50-59" não diz nada sozinho. Ao lado de "quantas internações no total naquela
  faixa" vira uma proporção — e é a proporção que responde "existe relação".
- Uma etapa de PANORAMA primeiro (o total, a distribuição geral), para as
  demais terem contra o que ser lidas.
- Uma etapa que tenta DERRUBAR a hipótese. Se a suspeita é que o padrão vem da
  idade, veja se ele não vem do sexo, da região ou do ano.

O QUE ESTA BASE NÃO PERMITE — e o plano tem de respeitar:
- A unidade é a INTERNAÇÃO, não a pessoa. A mesma pessoa reinternada conta
  várias vezes. Não existe incidência, prevalência nem risco populacional aqui:
  não há denominador de população. Só dá para falar em PARTICIPAÇÃO NAS
  INTERNAÇÕES.
- Não há como estabelecer causa. No máximo associação entre colunas.
- Não peça etapa que precise de dado que a base não tem (renda, escolaridade
  útil, hospital nominal, população residente).

Escreva cada `pergunta` de forma AUTOCONTIDA: ela vai sozinha para o gerador de
SQL, sem ver o resto do plano.
"""

REFLEXAO_PROMPT = """\
Você revisa uma investigação em andamento sobre o SIH/SUS antes de ela virar
resposta para o usuário.

Olhe as evidências coletadas e decida se elas sustentam uma resposta honesta.

Peça etapas extras quando — e só quando — houver um buraco no ARGUMENTO:
- há contagem bruta onde a conclusão exige proporção (falta o denominador);
- uma etapa voltou vazia ou com um valor que contradiz outra;
- a conclusão que está se formando tem uma explicação alternativa óbvia que
  ninguém testou (composição por sexo, por ano, por região).

NÃO peça etapa extra para refinar, enfeitar ou detalhar. O orçamento é curto e
cada etapa varre 144 milhões de linhas. Se as evidências já bastam para uma
resposta com ressalvas, diga `suficiente: true` e pare.
"""

SINTESE_PROMPT = """\
Você é um analista de saúde pública escrevendo o texto de abertura de um
relatório de investigação sobre o SIH/SUS. O leitor pode ser pesquisador ou
gestor, e vai ver todas as tabelas e gráficos abaixo do seu texto.

Estrutura:
1. A resposta direta à pergunta, em 1-2 frases. Se a resposta for "os dados não
   permitem afirmar isso", comece por aí.
2. As evidências que sustentam, citando os números com separador de milhar.
3. O que enfraquece ou limita a conclusão.

Regras que não se negociam:
- Só use números que aparecem nas evidências. Não interpole, não extrapole.
- A unidade é a INTERNAÇÃO, não a pessoa. Nunca escreva "X pessoas": escreva
  "X internações". A mesma pessoa reinternada conta várias vezes.
- NUNCA afirme causa. "Associado a", "acompanha", "é maior entre" — nunca
  "causa", "leva a", "provoca".
- Se a base não tem denominador populacional para o que foi perguntado, diga
  explicitamente que não dá para falar de risco ou incidência.
- Se alguma etapa falhou ou voltou vazia, diga qual e o que isso deixa em aberto.
- Nada de código, nada de SQL: o leitor vê a consulta de cada etapa no relatório.
"""


@dataclass
class Achado:
    """Uma etapa executada, com o que ela produziu."""

    pergunta: str
    proposito: str
    origem: str  # "plano" ou "reflexao"
    sql: str | None = None
    resultado: QueryResult | None = None
    chart: dict | None = None
    erro: str | None = None

    @property
    def ok(self) -> bool:
        return self.resultado is not None

    def para_prompt(self, max_linhas: int = 12) -> str:
        cabeca = f"### {self.pergunta}\n(propósito: {self.proposito})"
        if self.erro or self.resultado is None:
            return f"{cabeca}\nFALHOU: {self.erro or 'sem resultado'}"
        return f"{cabeca}\n{_format_rows(self.resultado, max_linhas)}"


@dataclass
class Relatorio:
    pergunta: str
    leitura: str
    achados: list[Achado] = field(default_factory=list)
    texto: str = ""
    lacuna: str = ""
    recusa: str = ""
    segundos: float = 0.0
    chamadas_llm: int = 0

    @property
    def etapas_ok(self) -> int:
        return sum(1 for a in self.achados if a.ok)


class Investigador:
    def __init__(self, agente: TextToSQLAgent | None = None, max_etapas: int = MAX_ETAPAS):
        self.agente = agente or TextToSQLAgent()
        self.max_etapas = max_etapas

    # -- fase 1 -------------------------------------------------------------
    def planejar(self, pergunta: str) -> dict:
        return complete(
            model=settings.sql_model,
            system=PLANO_PROMPT,
            messages=[{"role": "user", "content": f"Pergunta do usuário: {pergunta}"}],
            schema=PLANO_SCHEMA,
            schema_name="plano_investigacao",
            reasoning_effort="medium",
        )

    # -- fase 2 -------------------------------------------------------------
    def _executa_etapa(self, etapa: dict, origem: str) -> Achado:
        achado = Achado(
            pergunta=etapa["pergunta"], proposito=etapa.get("proposito", ""), origem=origem
        )
        try:
            hints = link_values(self.agente.db, achado.pergunta)
            plano = self.agente.generate_sql(achado.pergunta, hints=hints)
            if not plano.get("answerable"):
                achado.erro = plano.get("refusal") or "fora do alcance da base"
                return achado
            res, sql, _, erros = self.agente._execute_with_repair(achado.pergunta, plano, hints)
            achado.sql = _clean_sql(sql)
            if res is None:
                achado.erro = erros[-1] if erros else "execução falhou"
                return achado
            achado.resultado = res
            # O agente já declara a forma do gráfico; a validação contra as
            # colunas reais é a mesma do fluxo de pergunta única.
            from .agent import _valida_chart

            spec, _ = _valida_chart(plano.get("chart"), res)
            achado.chart = spec
        except Exception as exc:  # noqa: BLE001
            achado.erro = f"{type(exc).__name__}: {exc}"
        return achado

    def _executa_lote(self, etapas: list[dict], origem: str, workers: int = 4) -> list[Achado]:
        """Etapas de um mesmo lote são independentes por construção — vão juntas."""
        if not etapas:
            return []
        with cf.ThreadPoolExecutor(max_workers=min(workers, len(etapas))) as pool:
            futuros = [pool.submit(self._executa_etapa, e, origem) for e in etapas]
            return [f.result() for f in futuros]

    # -- fase 3 -------------------------------------------------------------
    def refletir(self, pergunta: str, achados: list[Achado], restante: int) -> dict:
        evidencias = "\n\n".join(a.para_prompt() for a in achados)
        user = (
            f"Pergunta original: {pergunta}\n\n"
            f"## EVIDÊNCIAS COLETADAS\n{evidencias}\n\n"
            f"Orçamento restante: {restante} etapa(s)."
        )
        return complete(
            model=settings.sql_model,
            system=REFLEXAO_PROMPT,
            messages=[{"role": "user", "content": user}],
            schema=REFLEXAO_SCHEMA,
            schema_name="reflexao",
            reasoning_effort="medium",
        )

    def sintetizar(self, pergunta: str, leitura: str, achados: list[Achado], lacuna: str) -> str:
        evidencias = "\n\n".join(a.para_prompt(max_linhas=20) for a in achados)
        user = f"Pergunta: {pergunta}\n\nLeitura do planejador: {leitura}\n\n{evidencias}"
        if lacuna:
            user += f"\n\n## LACUNA QUE NÃO FOI FECHADA\n{lacuna}"
        return complete(
            model=settings.answer_model,
            system=SINTESE_PROMPT,
            messages=[{"role": "user", "content": user}],
            reasoning_effort="low",
        )

    # -- orquestração -------------------------------------------------------
    def investigar(self, pergunta: str, verboso: bool = False) -> Relatorio:
        t0 = time.perf_counter()
        rel = Relatorio(pergunta=pergunta, leitura="")

        plano = self.planejar(pergunta)
        rel.chamadas_llm += 1
        rel.leitura = plano.get("leitura", "")
        if not plano.get("viavel"):
            rel.recusa = plano.get("recusa") or "A base não permite esta investigação."
            rel.segundos = time.perf_counter() - t0
            return rel

        etapas = plano.get("etapas", [])[: self.max_etapas]
        if verboso:
            print(f"  plano: {len(etapas)} etapa(s)")
            for e in etapas:
                print(f"    · {e['pergunta']}")

        rel.achados = self._executa_lote(etapas, "plano")
        rel.chamadas_llm += len(etapas)  # 1 geração de SQL por etapa, no mínimo

        restante = min(MAX_ETAPAS_REFLEXAO, self.max_etapas - len(rel.achados))
        if restante > 0:
            reflexao = self.refletir(pergunta, rel.achados, restante)
            rel.chamadas_llm += 1
            extras = reflexao.get("etapas_extras", [])[:restante]
            if not reflexao.get("suficiente") and extras:
                rel.lacuna = reflexao.get("lacuna", "")
                if verboso:
                    print(f"  reflexão: lacuna -> {rel.lacuna[:90]}")
                    for e in extras:
                        print(f"    + {e['pergunta']}")
                novos = self._executa_lote(extras, "reflexao")
                rel.achados.extend(novos)
                rel.chamadas_llm += len(extras)
                # A lacuna só continua aberta se as etapas extras falharam.
                if any(a.ok for a in novos):
                    rel.lacuna = ""

        rel.texto = self.sintetizar(pergunta, rel.leitura, rel.achados, rel.lacuna)
        rel.chamadas_llm += 1
        rel.segundos = time.perf_counter() - t0
        return rel


def para_json(rel: Relatorio) -> dict:
    """Formato que o frontend consumiria para montar o painel do relatório."""
    from .agent import _json_safe

    return {
        "question": rel.pergunta,
        "reading": rel.leitura,
        "text": rel.texto,
        "gap": rel.lacuna,
        "refusal": rel.recusa,
        "elapsed": round(rel.segundos, 1),
        "llmCalls": rel.chamadas_llm,
        "blocks": [
            {
                "question": a.pergunta,
                "purpose": a.proposito,
                "origin": a.origem,
                "sql": a.sql,
                "error": a.erro,
                "chart": a.chart,
                "result": (
                    {
                        "columns": a.resultado.columns,
                        "rows": [[_json_safe(v) for v in l] for l in a.resultado.rows[:200]],
                        "nRows": len(a.resultado.rows),
                        "elapsed": round(a.resultado.elapsed_s, 3),
                    }
                    if a.resultado
                    else None
                ),
            }
            for a in rel.achados
        ],
    }


if __name__ == "__main__":  # investigação avulsa pela linha de comando
    import sys

    pergunta = " ".join(sys.argv[1:]) or "Existe relação entre câncer e idade?"
    rel = Investigador().investigar(pergunta, verboso=True)
    print(json.dumps(para_json(rel), ensure_ascii=False, indent=1))
