"""Acesso ao DuckDB com conexão read-only e validação de SQL.

A defesa é em duas camadas:
  1. a conexão é aberta com access_mode=read_only — o próprio DuckDB recusa
     qualquer escrita;
  2. `validate_sql` recusa antes de executar tudo que não seja um SELECT único,
     para dar mensagem de erro clara e barrar leitura de tabelas proibidas.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from collections.abc import Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import unquote, urlparse

import duckdb

from .config import settings

# Tabelas que o chatbot nunca deve consultar (staging + dimensões vazias).
FORBIDDEN_TABLES = {"_staging_internacoes", "hospital", "socioeconomico"}

_WRITE_KEYWORDS = {
    "insert", "update", "delete", "drop", "create", "alter", "truncate",
    "attach", "detach", "copy", "export", "import", "install", "load",
    "pragma", "set", "call", "replace", "grant", "revoke", "vacuum", "checkpoint",
}


class UnsafeQueryError(ValueError):
    """SQL rejeitado antes de chegar ao banco."""


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[tuple]
    elapsed_s: float
    truncated: bool = False
    sql: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dicts(self) -> list[dict]:
        return [dict(zip(self.columns, r)) for r in self.rows]


def json_safe(v: Any) -> Any:
    """Converte os tipos do DuckDB que o JSON não conhece.

    Mora aqui, junto do `QueryResult`, porque TODO caminho que devolve linhas
    para a tela precisa dela — e descobrir isso um caminho de cada vez custa
    caro. O painel foi o terceiro: um widget agrupado por `date_trunc('month',
    DT_SAIDA)` derrubou a resposta inteira com "Object of type datetime is not
    JSON serializable", e como a serialização é do painel todo de uma vez, os
    oito widgets ficaram em branco por causa de um.
    """
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def linhas_json(linhas: Sequence[Sequence[Any]]) -> list[list]:
    """As linhas prontas para o JSON."""
    return [[json_safe(v) for v in linha] for linha in linhas]


def _parse_database_path(raw: str) -> str:
    """Extrai o caminho do arquivo de uma URL estilo SQLAlchemy ou de um path puro.

    Aceita 'duckdb:////abs/path.duckdb?access_mode=read_only' e '/abs/path.duckdb'.
    """
    if not raw:
        raise ValueError("DATABASE_PATH não está definido no .env")
    if "://" not in raw:
        return raw
    parsed = urlparse(raw)
    path = unquote(parsed.path)
    # duckdb:////abs/path vira netloc='' e path='//abs/path'
    while path.startswith("//"):
        path = path[1:]
    return path


def _strip_sql_noise(sql: str) -> str:
    """Remove comentários e literais de string, para a análise léxica não se confundir."""
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"'(?:''|[^'])*'", "''", sql)
    sql = re.sub(r'"(?:""|[^"])*"', '""', sql)
    return sql


def validate_sql(sql: str) -> str:
    """Valida e normaliza a query. Devolve o SQL pronto para executar."""
    if not sql or not sql.strip():
        raise UnsafeQueryError("SQL vazio.")

    cleaned = _strip_sql_noise(sql).strip().rstrip(";").strip()
    if not cleaned:
        raise UnsafeQueryError("SQL contém apenas comentários.")

    # Um único statement: nenhum ';' pode sobrar depois de tirar o final.
    if ";" in cleaned:
        raise UnsafeQueryError("Apenas um comando SQL por vez é permitido.")

    lowered = cleaned.lower()
    first = re.match(r"\s*(\w+)", lowered)
    if not first or first.group(1) not in {"select", "with"}:
        raise UnsafeQueryError(
            f"Apenas SELECT/WITH são permitidos (recebido: '{first.group(1) if first else '?'}')."
        )

    tokens = set(re.findall(r"\b[a-z_]+\b", lowered))
    banned = tokens & _WRITE_KEYWORDS
    if banned:
        raise UnsafeQueryError(f"Comando não permitido: {', '.join(sorted(banned))}.")

    hit = tokens & {t.lower() for t in FORBIDDEN_TABLES}
    if hit:
        names = ", ".join(sorted(hit))
        raise UnsafeQueryError(
            f"Tabela proibida: {names}. "
            "`_staging_internacoes` é carga intermediária; `hospital` e "
            "`socioeconomico` estão vazias."
        )

    return sql.strip().rstrip(";")


# Teto para consultas agregadas. Um GROUP BY já é limitado pela cardinalidade da
# chave, então este valor só existe para conter um agrupamento acidental por uma
# coluna de altíssima cardinalidade (N_AIH, por exemplo).
AGG_LIMIT = 10_000


def enforce_limit(sql: str, limit: int | None = None) -> tuple[str, int | None]:
    """Injeta LIMIT quando não há um explícito.

    Devolve (sql, limite_aplicado). `limite_aplicado` permite ao chamador
    detectar truncamento — devolver 100 de 5.563 grupos sem avisar seria pior do
    que devolver um erro.
    """
    cleaned = _strip_sql_noise(sql).lower()
    if re.search(r"\blimit\b\s+\d+", cleaned):
        return sql, None

    has_group_by = bool(re.search(r"\bgroup\s+by\b", cleaned))
    has_agg_fn = bool(
        re.search(r"\b(count|sum|avg|min|max|median|quantile\w*)\s*\(", cleaned)
    )

    # Agregação escalar: uma linha só, LIMIT é irrelevante.
    if has_agg_fn and not has_group_by:
        return sql, None

    applied = AGG_LIMIT if has_group_by else (limit or settings.default_limit)
    return f"{sql.rstrip().rstrip(';')}\nLIMIT {applied}", applied


class Database:
    """Wrapper fino sobre a conexão DuckDB read-only."""

    def __init__(self, path: str | None = None, threads: int = 8):
        self.path = _parse_database_path(path or settings.database_path)
        self._con = duckdb.connect(self.path, read_only=True)
        self._con.execute(f"PRAGMA threads={threads}")
        self._lock = threading.Lock()

    def run(
        self,
        sql: str,
        *,
        params: Sequence[Any] | None = None,
        validate: bool = True,
        add_limit: bool = True,
        max_rows: int | None = None,
    ) -> QueryResult:
        """Executa a query. `params` vincula os `?` — nunca concatene valor no SQL.

        A vinculação existe para o painel, cujos widgets guardam um SQL com
        marcadores e trocam só os valores quando o filtro muda. Mas o ganho maior
        é de segurança e vale para qualquer chamador: um valor vindo da interface
        deixa de poder virar sintaxe. Concatenar `WHERE ano = {v}` com v vindo de
        fora é a definição de injeção — o validador barra `DROP` no SQL do
        modelo, e não barraria um valor de filtro que carregasse um.
        """
        import time

        applied_limit: int | None = None
        if validate:
            sql = validate_sql(sql)
        if add_limit:
            sql, applied_limit = enforce_limit(sql)

        start = time.perf_counter()
        with self._lock:
            # Cursor separado permite interromper sem derrubar a conexão.
            cur = self._con.cursor()
            timer = threading.Timer(settings.query_timeout_s, cur.interrupt)
            timer.start()
            try:
                cur.execute(sql, list(params)) if params else cur.execute(sql)
                columns = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchall()
            finally:
                timer.cancel()
                cur.close()
        elapsed = time.perf_counter() - start

        # Se o resultado bateu exatamente no LIMIT injetado, provavelmente há
        # mais linhas — quem consome precisa saber para não afirmar um total.
        hit_limit = applied_limit is not None and len(rows) == applied_limit

        truncated = False
        if max_rows is not None and len(rows) > max_rows:
            rows = rows[:max_rows]
            truncated = True

        return QueryResult(
            columns=columns,
            rows=rows,
            elapsed_s=elapsed,
            truncated=truncated,
            sql=sql,
            extra={"hit_injected_limit": hit_limit, "applied_limit": applied_limit},
        )

    def explain(self, sql: str) -> str:
        """Valida a query sem executá-la (pega erro de sintaxe/coluna inexistente)."""
        sql = validate_sql(sql)
        with self._lock:
            return self._con.execute(f"EXPLAIN {sql}").fetchall()[0][1]

    def close(self) -> None:
        self._con.close()
