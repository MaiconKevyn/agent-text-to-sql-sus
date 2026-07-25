"""API HTTP do agente.

    .venv/bin/uvicorn src.api:app --reload --port 8000

Três rotas:
    GET /api/health   estado do banco e do modelo
    GET /api/schema   estrutura do banco, para o explorador do frontend
    GET /api/ask?q=…  eventos do agente via Server-Sent Events

O SSE usa GET porque `EventSource` no navegador só faz GET. Cada evento é uma
linha `data: {...}` com o mesmo formato que o frontend já consome — o contrato
está em `frontend/src/lib/types.ts` (`StreamEvent`).
"""
from __future__ import annotations

import functools
import json
from collections.abc import Iterator

import yaml
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .investigation import Investigador
from .agent import TextToSQLAgent, Turn
from .config import settings
from .db import Database

app = FastAPI(
    title="Consulta SIH/SUS",
    description="Perguntas em português sobre 144 milhões de internações do SUS.",
    version="1.0.0",
)

# O Vite serve em 5173; as portas alternativas cobrem o caso de a principal
# estar ocupada.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):(5173|5174|5175|4173)",
    allow_methods=["GET"],
    allow_headers=["*"],
)

_db: Database | None = None
_agent: TextToSQLAgent | None = None


def agente() -> TextToSQLAgent:
    """Instância única. Abrir o DuckDB de 15 GB a cada requisição seria absurdo."""
    global _db, _agent
    if _agent is None:
        _db = Database()
        _agent = TextToSQLAgent(db=_db)
    return _agent


_investigador: Investigador | None = None


def investigador() -> Investigador:
    """Reusa o mesmo agente do /api/ask — mesma conexão, mesmo dicionário."""
    global _investigador
    if _investigador is None:
        _investigador = Investigador(agente())
    return _investigador


def sse(evento: dict) -> str:
    return f"data: {json.dumps(evento, ensure_ascii=False)}\n\n"


@app.get("/api/health")
def health() -> JSONResponse:
    try:
        n = agente().db.run("SELECT count(*) FROM internacoes", add_limit=False).rows[0][0]
        return JSONResponse(
            {
                "ok": True,
                "internacoes": n,
                "model": settings.sql_model,
                "database": agente().db.path.rsplit("/", 1)[-1],
            }
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)


@functools.lru_cache(maxsize=1)
def _schema_payload() -> dict:
    """Monta a estrutura do banco a partir do dicionário curado + contagens reais.

    Em cache: o conteúdo só muda se o YAML ou o banco mudarem, e ambos são
    estáticos durante a execução do servidor.
    """
    db = agente().db
    doc = yaml.safe_load(open(settings.schema_file, encoding="utf-8"))
    vazias = {"hospital", "socioeconomico"}
    proibidas = {"_staging_internacoes"}

    def colunas_do_banco(nome: str) -> list[dict]:
        try:
            r = db.run(
                "SELECT column_name, data_type FROM information_schema.columns "
                f"WHERE table_schema='main' AND table_name='{nome}' ORDER BY ordinal_position",
                validate=False,
                add_limit=False,
            )
            return [{"name": c, "type": t, "desc": ""} for c, t in r.rows]
        except Exception:
            return []

    def linhas(nome: str, padrao: int = 0) -> int:
        try:
            return int(db.run(f'SELECT count(*) FROM "{nome}"', validate=False, add_limit=False).rows[0][0])
        except Exception:
            return padrao

    tabelas = []
    for nome, spec in doc["tables"].items():
        cols = [
            {"name": c, "type": m.get("type", ""), "desc": m.get("desc", "")}
            if isinstance(m, dict)
            else {"name": c, "type": "", "desc": str(m)}
            for c, m in (spec.get("columns") or {}).items()
        ]
        if not cols:
            cols = colunas_do_banco(nome)
        tabelas.append(
            {
                "name": nome,
                "role": spec.get("role", "dimensao"),
                "rows": linhas(nome, spec.get("rows", 0)),
                "description": (spec.get("description") or spec.get("grain") or "").strip(),
                "caveat": (spec.get("caveat") or "").strip() or None,
                "empty": nome in vazias,
                "forbidden": nome in proibidas,
                "columns": cols,
                "domain": {str(k): v for k, v in spec["values"].items()} if spec.get("values") else None,
            }
        )

    for nome, motivo in doc.get("forbidden_tables", {}).items():
        if any(t["name"] == nome for t in tabelas):
            continue
        n = linhas(nome)
        tabelas.append(
            {
                "name": nome,
                "role": "indisponivel",
                "rows": n,
                "description": motivo,
                "caveat": None,
                "empty": n == 0,
                "forbidden": nome in proibidas,
                "columns": colunas_do_banco(nome),
                "domain": None,
            }
        )

    tabelas.sort(key=lambda t: (t["role"] != "fato", -t["rows"]))
    return {
        "tables": tabelas,
        "rules": [
            {"id": r["id"], "severity": r["severity"], "text": r["text"].strip()}
            for r in doc["rules"]
        ],
        "period": doc["database"]["period"].strip(),
        "grain": doc["database"]["grain"].strip(),
    }


@app.get("/api/schema")
def schema() -> JSONResponse:
    return JSONResponse(_schema_payload())


@app.get("/api/investigate")
def investigate(
    q: str = Query(..., min_length=8, max_length=2000, description="Pergunta de investigação"),
) -> StreamingResponse:
    """Investigação com várias consultas. Leva minutos — daí o SSE.

    Endpoint separado do /api/ask de propósito: uma investigação custa 7-9
    chamadas de LLM e varre 144 milhões de linhas várias vezes. É um modo que o
    usuário escolhe sabendo que vai esperar, nunca o caminho padrão.
    """

    def fluxo() -> Iterator[str]:
        try:
            for evento in investigador().investigar_stream(q):
                yield sse(evento)
        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "failure", "message": f"Erro inesperado no servidor: {exc}"})
            yield sse({"type": "done"})

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/ask")
def ask(
    q: str = Query(..., min_length=2, max_length=2000, description="Pergunta em português"),
    history: str | None = Query(
        None, description="JSON com as rodadas anteriores: [{question, sql}]"
    ),
) -> StreamingResponse:
    turnos: list[Turn] = []
    if history:
        try:
            turnos = [
                Turn(question=h["question"], sql=h.get("sql"))
                for h in json.loads(history)
                if h.get("question")
            ]
        except Exception:
            turnos = []  # histórico malformado não deve impedir a pergunta

    def fluxo() -> Iterator[str]:
        try:
            for evento in agente().ask_stream(q, turnos):
                yield sse(evento)
        except Exception as exc:  # noqa: BLE001
            yield sse(
                {
                    "type": "failure",
                    "kind": "rede",
                    "message": f"Erro inesperado no servidor: {exc}",
                }
            )
            yield sse({"type": "done"})

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Impede buffering se houver um proxy na frente; sem isso o
            # streaming chega todo de uma vez.
            "X-Accel-Buffering": "no",
        },
    )
