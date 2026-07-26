"""Configuração central, carregada do .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    database_path: str = os.getenv("DATABASE_PATH", "")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")

    # Modelo usado para gerar SQL. gpt-5 dá o melhor resultado; gpt-5-mini
    # custa uma fração e foi o usado na avaliação registrada no README.
    sql_model: str = os.getenv("SQL_MODEL", "gpt-5-mini")
    # Modelo para redigir a resposta final — tarefa mais leve.
    answer_model: str = os.getenv("ANSWER_MODEL", "gpt-5-mini")

    schema_file: Path = ROOT / "knowledge" / "schema.yaml"
    ground_truth_file: Path = ROOT / "eval" / "ground_truth.yaml"

    # Teto de linhas devolvidas ao LLM para ele interpretar.
    max_rows_to_llm: int = int(os.getenv("MAX_ROWS_TO_LLM", "50"))
    # LIMIT injetado em queries sem agregação.
    default_limit: int = int(os.getenv("DEFAULT_LIMIT", "100"))
    # Timeout duro de execução, em segundos.
    query_timeout_s: int = int(os.getenv("QUERY_TIMEOUT_S", "120"))
    # Onde ficam os temas de investigação. Um JSON por tema.
    themes_dir: str = os.getenv("THEMES_DIR", "data/temas")
    # Tentativas de auto-correção após erro de SQL.
    max_repair_attempts: int = int(os.getenv("MAX_REPAIR_ATTEMPTS", "2"))


settings = Settings()
