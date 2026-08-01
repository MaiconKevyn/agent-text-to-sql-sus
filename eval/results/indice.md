# Execuções da avaliação

Uma linha por execução, da mais recente para a mais antiga. O detalhe de cada
uma está em `eval_NNN/resumo.md`.

**A acurácia deste agente varia uns 4 pontos entre execuções idênticas** — 15%
das falhas passam numa segunda tentativa sem nada mudar no código. Uma variação
menor que isso entre duas linhas desta tabela não é sinal; é ruído.

Quando a coluna de recusa diz `excluída`, a execução rodou sem os casos
irrespondíveis: a acurácia dela é sobre os respondíveis e só se compara com a
coluna `execução` das outras linhas.

| # | quando | modelo | casos | geral | execução | recusa | nota |
|---|---|---|---|---|---|---|---|
| 4 | 2026-08-01 20:44 | `gpt-5-mini` | 6 | 100.0% | 100.0% | excluída | só respondíveis |
| 3 | 2026-08-01 20:35 | `gpt-5-mini` | 272 | 72.8% | 73.4% | 68.6% |  |
| 1 | 2026-07-26 13:06 | `gpt-5-mini` | 272 | 73.2% | 72.2% | 80.0% | medição herdada de eval/eval_report.json, antes da reorganização |
