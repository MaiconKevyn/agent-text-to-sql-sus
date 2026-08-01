# Execuções da avaliação

Uma linha por execução, da mais recente para a mais antiga. O detalhe de cada
uma está em `eval_NNN/resumo.md`.

**A acurácia deste agente varia uns 4 pontos entre execuções idênticas** — 15%
das falhas passam numa segunda tentativa sem nada mudar no código. Uma variação
menor que isso entre duas linhas desta tabela não é sinal; é ruído.

| # | quando | modelo | casos | geral | execução | recusa | nota |
|---|---|---|---|---|---|---|---|
| 2 | 2026-08-01 20:08 | `gpt-5-mini` | 3 | 100.0% | 100.0% | — | reorganização do eval em results/ |
| 1 | 2026-07-26 13:06 | `gpt-5-mini` | 272 | 73.2% | 72.2% | 80.0% | medição herdada de eval/eval_report.json, antes da reorganização |
