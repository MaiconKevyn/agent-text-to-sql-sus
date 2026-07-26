"""Camada fina sobre a API do provedor de LLM.

Isolada num módulo só para que trocar de provedor (ou de modelo) não toque no
resto do pipeline.
"""
from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from openai import OpenAI

from .config import settings

_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if _client is None:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY não configurada no .env")
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


def complete(
    *,
    model: str,
    system: str,
    messages: list[dict[str, str]],
    schema: dict[str, Any] | None = None,
    schema_name: str = "resposta",
    reasoning_effort: str | None = None,
) -> str | dict:
    """Chama o modelo. Com `schema`, devolve dict validado contra o JSON Schema."""
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": system}, *messages],
    }
    if schema is not None:
        kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "strict": True, "schema": schema},
        }
    if reasoning_effort and model.startswith(("gpt-5", "o3", "o4")):
        kwargs["reasoning_effort"] = reasoning_effort

    resp = client().chat.completions.create(**kwargs)
    content = resp.choices[0].message.content or ""
    return json.loads(content) if schema is not None else content


def complete_streaming(
    *,
    model: str,
    system: str,
    messages: list[dict[str, str]],
    reasoning_effort: str | None = None,
) -> Iterator[str]:
    """Igual a `complete`, mas devolve o texto em pedaços conforme chega.

    Usado só na redação da resposta final — é a única etapa cujo resultado o
    usuário lê enquanto é produzido. A geração de SQL continua não-streaming
    porque o JSON só serve completo.
    """
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": system}, *messages],
        "stream": True,
    }
    if reasoning_effort and model.startswith(("gpt-5", "o3", "o4")):
        kwargs["reasoning_effort"] = reasoning_effort

    for chunk in client().chat.completions.create(**kwargs):
        if not chunk.choices:
            continue
        pedaco = chunk.choices[0].delta.content
        if pedaco:
            yield pedaco


# JSON Schema da etapa de geração de SQL.
SQL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answerable", "reasoning", "sql", "assumptions", "refusal", "chart"],
    "properties": {
        "answerable": {
            "type": "boolean",
            "description": "A pergunta pode ser respondida com as tabelas disponíveis?",
        },
        "reasoning": {
            "type": "string",
            "description": "Raciocínio curto: tabelas, filtros e regras críticas aplicadas.",
        },
        "sql": {
            "type": "string",
            "description": "A query SELECT em DuckDB. String vazia se answerable=false.",
        },
        "assumptions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Interpretações assumidas que o usuário deveria conferir.",
        },
        "refusal": {
            "type": "string",
            "description": "Se answerable=false, explique o que falta na base. Senão, vazio.",
        },
        # O modelo declara a FORMA do gráfico e quais colunas usar. Ele nunca
        # produz os pontos: quem monta a série é o frontend, a partir das linhas
        # que o DuckDB devolveu. Assim o gráfico não pode conter um número que
        # a consulta não retornou.
        "chart": {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "x", "y", "series", "title", "reason"],
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": [
                        "nenhum",
                        "linha",
                        "barra",
                        "barra_horizontal",
                        "pizza",
                        "dispersao",
                        "heatmap",
                        "empilhada_100",
                    ],
                    "description": "Forma do gráfico. 'nenhum' quando um gráfico não ajuda.",
                },
                "x": {
                    "type": "string",
                    "description": "Nome EXATO da coluna do SELECT no eixo de categoria. Vazio se kind=nenhum.",
                },
                "y": {
                    "type": "string",
                    "description": "Nome EXATO da coluna do SELECT com a medida numérica.",
                },
                "series": {
                    "type": "string",
                    "description": "Coluna que separa séries (ex.: sexo, região). Vazio se houver só uma série.",
                },
                "title": {"type": "string", "description": "Título curto do gráfico."},
                "reason": {
                    "type": "string",
                    "description": "Uma frase: por que esta forma, ou por que nenhum gráfico.",
                },
            },
        },
    },
}


# O campo `continuidade` só existe quando HÁ histórico. Isso não é elegância:
# acrescentar um campo ao schema muda o que o modelo produz em toda chamada, e a
# avaliação roda sempre sem histórico (eval/run_eval.py chama `ask(question)`
# sem `history`). Mantendo dois schemas, o caminho da avaliação continua
# recebendo exatamente o mesmo contrato de antes — a garantia é estrutural, não
# uma promessa.
SQL_SCHEMA_COM_HISTORICO: dict[str, Any] = {
    **SQL_SCHEMA,
    "required": [*SQL_SCHEMA["required"], "continuidade"],
    "properties": {
        **SQL_SCHEMA["properties"],
        "continuidade": {
            "type": "object",
            "additionalProperties": False,
            "required": ["tipo", "herdado", "descartado"],
            "properties": {
                "tipo": {
                    "type": "string",
                    "enum": ["acompanhamento", "nova"],
                    "description": (
                        "'acompanhamento' se esta pergunta continua a anterior e você "
                        "partiu do SQL dela; 'nova' se é outro assunto e você começou "
                        "do zero."
                    ),
                },
                "herdado": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Cada recorte da pergunta anterior que você MANTEVE, em português "
                        "e com a coluna: \"filtro de covid: DIAG_PRINC = 'B342'\". "
                        "Vazio quando tipo='nova'."
                    ),
                },
                "descartado": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Cada recorte da pergunta anterior que você NÃO manteve, e por quê. "
                        "É o campo mais importante: um filtro descartado em silêncio é "
                        "como uma resposta sobre outro assunto passa por resposta certa."
                    ),
                },
            },
        },
    },
}
