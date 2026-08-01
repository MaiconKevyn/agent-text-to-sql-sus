# Execução 4

- **quando** 2026-08-01T20:41:39
- **modelo** `gpt-5-mini`
- **comando** `python -m eval.run_eval --limit 3 --recusa exclui --nota 'conferindo o filtro de recusa'`
- **nota** conferindo o filtro de recusa

> **Execução parcial** (`--recusa exclui`): os 35 casos irrespondíveis ficaram de fora. Não mede recusa, e a acurácia geral aqui é a execution accuracy — não compare com a de uma rodada completa.

## Resultado

| | |
|---|---|
| Acurácia geral | 3/3 (100.0%) |
| Execution accuracy | 3/3 (100.0%) |
| Recusa correta | — |

## Por categoria

| categoria | acertos |
|---|---|
| agregacao_simples | 3/3 (100.0%) |

---

O detalhe caso a caso — SQL previsto, linhas devolvidas, erros — está em
`relatorio.json`, ao lado deste arquivo.
