"""Interface de linha de comando do chatbot.

    python -m src.cli                      # modo interativo
    python -m src.cli "sua pergunta aqui"  # pergunta única
    python -m src.cli --sql "..."          # executa SQL direto (debug)
"""
from __future__ import annotations

import argparse
import sys

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from .agent import AgentResult, ChatSession, TextToSQLAgent
from .db import Database

console = Console()

BANNER = """\
[bold cyan]Chatbot SIH/SUS[/] — perguntas em português sobre 144 milhões de internações \
hospitalares do SUS (2007-2023).

Exemplos:
  • Quantas internações de mulheres houve em 2019?
  • Quais os 10 diagnósticos mais frequentes?
  • Qual a taxa de mortalidade por UTI?
  • Como evoluiu o gasto com alta complexidade ao longo dos anos?

Perguntas de acompanhamento funcionam: depois de uma resposta, pergunte
"e em 2020?" ou "agora só para homens".

[dim]Comandos: /sql mostra a última query · /novo limpa o contexto · /sair encerra[/]"""


def render(result: AgentResult, show_sql: bool = True) -> None:
    if not result.answerable:
        console.print(Panel(result.answer, title="[yellow]Fora do alcance da base[/]",
                            border_style="yellow"))
        return

    if show_sql and result.sql:
        console.print(Syntax(result.sql, "sql", theme="ansi_dark", word_wrap=True))

    if result.result and result.result.rows:
        res = result.result
        if len(res.rows) > 1 or len(res.columns) > 1:
            table = Table(show_header=True, header_style="bold cyan", box=None)
            for col in res.columns:
                table.add_column(str(col))
            for row in res.rows[:20]:
                table.add_row(*["—" if v is None else str(v) for v in row])
            console.print(table)
            if len(res.rows) > 20:
                console.print(f"[dim]… +{len(res.rows) - 20} linhas[/]")
        meta = f"[dim]{len(res.rows)} linha(s) · {res.elapsed_s:.2f}s"
        if result.attempts > 1:
            meta += f" · {result.attempts} tentativas de SQL"
        console.print(meta + "[/]")

    console.print(Panel(Markdown(result.answer), title="[green]Resposta[/]",
                        border_style="green"))


def main() -> int:
    ap = argparse.ArgumentParser(description="Chatbot text-to-SQL sobre o SIH/SUS")
    ap.add_argument("question", nargs="*", help="pergunta; sem isso entra no modo interativo")
    ap.add_argument("--sql", help="executa um SQL direto, sem passar pelo LLM")
    ap.add_argument("--no-sql", action="store_true", help="não exibir a query gerada")
    args = ap.parse_args()

    if args.sql:
        res = Database().run(args.sql)
        table = Table(show_header=True, header_style="bold cyan")
        for c in res.columns:
            table.add_column(str(c))
        for row in res.rows[:50]:
            table.add_row(*["—" if v is None else str(v) for v in row])
        console.print(table)
        console.print(f"[dim]{len(res.rows)} linha(s) · {res.elapsed_s:.2f}s[/]")
        return 0

    if args.question:
        render(TextToSQLAgent().ask(" ".join(args.question)), show_sql=not args.no_sql)
        return 0

    session = ChatSession()
    console.print(Panel(BANNER, border_style="cyan"))
    last: AgentResult | None = None
    while True:
        try:
            q = console.input("\n[bold cyan]você ›[/] ").strip()
        except (EOFError, KeyboardInterrupt):
            console.print("\nAté mais.")
            return 0
        if not q:
            continue
        if q.lower() in {"/sair", "/quit", "/exit", "sair"}:
            console.print("Até mais.")
            return 0
        if q.lower() == "/novo":
            session.reset()
            console.print("[dim]Contexto limpo.[/]")
            continue
        if q.lower() == "/sql":
            if last and last.sql:
                console.print(Syntax(last.sql, "sql", theme="ansi_dark"))
            else:
                console.print("[dim]Nenhuma query ainda.[/]")
            continue

        with console.status("[dim]consultando…[/]"):
            try:
                last = session.ask(q)
            except Exception as exc:  # noqa: BLE001
                console.print(f"[red]Erro:[/] {exc}")
                continue
        render(last, show_sql=not args.no_sql)


if __name__ == "__main__":
    sys.exit(main())
