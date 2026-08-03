# Execução 5

- **quando** 2026-08-01T21:01:22
- **modelo** `gpt-5-mini`
- **comando** `python -m eval.run_eval --recusa exclui`

> **Execução parcial** (`--recusa exclui`): os 35 casos irrespondíveis ficaram de fora. Não mede recusa, e a acurácia geral aqui é a execution accuracy — não compare com a de uma rodada completa.

## Resultado

| | |
|---|---|
| Acurácia geral | 168/237 (70.9%) |
| Execution accuracy | 168/237 (70.9%) |
| Recusa correta | — |

## Por categoria

| categoria | acertos |
|---|---|
| agregacao_complexa | 16/44 (36.4%) |
| taxa | 11/21 (52.4%) |
| join_dimensao | 34/53 (64.2%) |
| dominio | 2/3 (66.7%) |
| temporal | 19/24 (79.2%) |
| filtro | 52/58 (89.7%) |
| agregacao_simples | 23/23 (100.0%) |
| armadilha | 10/10 (100.0%) |
| dado_corrompido | 1/1 (100.0%) |

## Falhas · 69

- `agg_taxa_mortalidade_geral` **[RESULTADO≠]** — Qual a taxa de mortalidade hospitalar geral?
- `cid_infarto_2023` **[RESULTADO≠]** — Quantas internações por infarto agudo do miocárdio ocorreram em 2023?
- `cid_por_capitulo` **[RESULTADO≠]** — Quantas internações por capítulo da CID-10?
- `carint_urgencia_vs_eletivo` **[EXCEÇÃO]** — Como se distribuem as internações por caráter (eletivo, urgência e demais categorias)?
- `multi_participacao_uti_no_gasto` **[RESULTADO≠]** — Que percentual do gasto total corresponde a UTI?
- `gt_gt014` **[RESULTADO≠]** — Quantas internações por meningite ocasionaram em morte?
- `gt_gt028` **[RESULTADO≠]** — Quais sao os 10 municípios com mais de 100 internações com a maior taxa de mortalidade?
- `gt_gt029` **[RESULTADO≠]** — Qual é o valor médio de UTI para homens?
- `gt_gt037` **[RECUSOU]** — Quantos pacientes nasceram antes de 1950?
- `gt_gt044` **[RESULTADO≠]** — Qual o custo médio de UTI por faixa etária dos pacientes?
- `gt_gt048` **[RESULTADO≠]** — Quais são as 10 principais causas de morte (com descrição)?
- `gt_gt065` **[RESULTADO≠]** — Qual o nível de instrução dos pacientes internados?
- `gt_gt070` **[RESULTADO≠]** — Quais os 10 motivos mais comuns de internação para pacientes indígenas?
- `gt_gt077` **[RESULTADO≠]** — Qual a média de dias de internação por município?
- `gt_gt078` **[RESULTADO≠]** — Quais são os 10 principais motivos de internação para pacientes com menos de 18 anos, entre 18 e 64 anos, e acima de 64 anos?
- `gt_gt083` **[RESULTADO≠]** — Qual é a taxa de mortalidade por nível de instrução no estado do RS, considerando apenas grupos com mais de 1000 internações?
- `gt_gt084` **[RESULTADO≠]** — Quais são os 3 procedimentos mais comuns entre internações que resultaram em óbito para cada faixa etária: menor de 18, 18 a 64, e 65 ou mais?
- `gt_gt087` **[RESULTADO≠]** — Qual a evolução anual da taxa de mortalidade por estado (MA e RS)?
- `gt_gt090` **[RESULTADO≠]** — Quais são os 10 diagnósticos com maior média de dias de internação (com mais de 10000 casos)?
- `gt_gt093` **[RESULTADO≠]** — Em qual ano ocorreu o maior número de mortes em cada estado (MA e RS)?
- `gt_gt099` **[RESULTADO≠]** — Qual o total gasto em internações de UTI?
- `gt_gt113` **[RESULTADO≠]** — Quais são os 10 municípios do RS com taxa de mortalidade acima da média estadual (considerando apenas municípios com mais de 500 internações)?
- `gt_gt114` **[RESULTADO≠]** — Qual a distribuição dos métodos contraceptivos utilizados por pacientes em internações obstétricas, incluindo os casos sem informação?
- `gt_gt115` **[RESULTADO≠]** — Qual o hospital com maior receita total por especialidade médica, considerando apenas hospitais com mais de 500 internações na especialidade?
- `gt_gt120` **[RESULTADO≠]** — Qual o total e o percentual de internações por doenças respiratórias (CID J%) em cada trimestre do ano no estado do RS? Considere a data de internação (entrada).
- `gt_gt121` **[RESULTADO≠]** — Quais municípios com mais de 500 internações aparecem simultaneamente no top-20 de volume e no top-20 de taxa de mortalidade nos estados MA e RS?
- `gt_gt122` **[RESULTADO≠]** — Quais procedimentos, ordenados por volume decrescente, cobrem até 80% do total de atendimentos realizados?
- `gt_gt124` **[RESULTADO≠]** — Qual a média móvel de 3 anos de internações no estado do RS por ano (2008-2023)?
- `gt_gt126` **[RESULTADO≠]** — Como se distribuem os hospitais em quartis de volume de internações? Mostre o número de hospitais e o intervalo de internações por quartil.
- `gt_gt129` **[RESULTADO≠]** — Quais códigos CID aparecem como diagnóstico principal em óbitos registrados?
- `gt_gt130` **[RESULTADO≠]** — Quais são os 10 municípios com maior taxa de mortalidade em internações obstétricas, entre aqueles com mais de 200 internações obstétricas e taxa acima da média nacional obstétrica?
- `gt_gt140` **[RESULTADO≠]** — Quantas internacoes por COVID ou coronavirus foram registradas?
- `gt_gt141` **[RESULTADO≠]** — Quantas internacoes por diabetes foram registradas?
- `gt_gt166` **[RESULTADO≠]** — Quantos registros de procedimento estao sem codigo de procedimento realizado?
- `gt_gt171` **[RESULTADO≠]** — Qual a taxa de mortalidade por complexidade assistencial?
- `gt_gt173` **[RESULTADO≠]** — Quais sao os 10 CIDs de infarto agudo do miocardio mais frequentes nas internacoes?
- `gt_gt174` **[RESULTADO≠]** — Quais capitulos CID aparecem com maior volume de internacoes?
- `gt_gt179` **[RESULTADO≠]** — Qual a taxa de mortalidade por raca/cor identificada?
- `gt_gt181` **[RESULTADO≠]** — Qual a evolucao anual das internacoes por doencas respiratorias?
- `gt_gt182` **[RESULTADO≠]** — Qual a evolucao anual de internacoes e mortes por COVID ou coronavirus?
- `gt_gt191` **[RESULTADO≠]** — Quais nacionalidades aparecem com maior volume de internacoes? Liste os 10 primeiros.
- `gt_gt193` **[RESULTADO≠]** — Qual a taxa de mortalidade por nivel de instrucao?
- `gt_gt196` **[RESULTADO≠]** — Qual a evolucao anual das internacoes por parto cesariano?
- `gt_gt197` **[RESULTADO≠]** — Como as internacoes obstetricas se distribuem por faixa etaria?
- `gt_gt198` **[RESULTADO≠]** — Quais capitulos CID tem maior custo total de internacoes?
- `gt_gt200` **[RESULTADO≠]** — Qual a distribuicao de internacoes por tipo de UTI registrada?
- `gt_gt201` **[RESULTADO≠]** — Qual a taxa anual de mortalidade nas internacoes por COVID ou coronavirus?
- `gt_gt202` **[RESULTADO≠]** — Quais faixas etarias tiveram maior taxa de mortalidade em internacoes por COVID ou coronavirus, considerando apenas faixas com mais de 10000 internacoes?
- `gt_gt203` **[RESULTADO≠]** — Como a taxa de mortalidade por doencas respiratorias compara inverno e fora do inverno por ano? Considere a data de internação (entrada).
- `gt_gt204` **[RESULTADO≠]** — Quais sao os 3 CIDs com maior taxa de mortalidade em cada estado MA e RS, considerando CIDs com mais de 1000 internacoes?
- `gt_gt205` **[RESULTADO≠]** — Quais municipios do RS tem taxa de uso de UTI acima da media estadual, considerando apenas municipios com mais de 1000 internacoes?
- `gt_gt206` **[RESULTADO≠]** — Qual a razao anual entre uso de UTI em pacientes com 65 anos ou mais e pacientes com menos de 65 anos?
- `gt_gt207` **[RESULTADO≠]** — Quais diagnosticos tiveram maior custo total de UTI entre internacoes que resultaram em obito? Liste os 10 primeiros.
- `gt_gt208` **[RESULTADO≠]** — Quais diagnosticos apresentam maior diferenca de permanencia media entre criancas e adultos, considerando diagnosticos com pelo menos 1000 internacoes em cada grupo? Liste os 10 primeiros.
- `gt_gt210` **[RESULTADO≠]** — Qual procedimento mais frequente em cada capitulo CID?
- `gt_gt211` **[RESULTADO≠]** — Qual percentual de internacoes de cada ano entre 2019 e 2023 foi por capitulo CID?
- `gt_gt212` **[RESULTADO≠]** — Em qual combinacao de estado e ano MA/RS ocorreu a maior taxa de mortalidade em internacoes com UTI?
- `gt_gt213` **[RESULTADO≠]** — Como a taxa de mortalidade compara internacoes de urgencia e eletivas por faixa etaria?
- `gt_gt215` **[RESULTADO≠]** — Quais municipios tiveram crescimento de internacoes em todos os anos de 2019 a 2021?
- `gt_gt216` **[RESULTADO≠]** — Qual a media movel de 3 anos da taxa de mortalidade no RS?
- `gt_gt219` **[RESULTADO≠]** — Quais diagnosticos tiveram maior aumento na taxa de mortalidade entre 2008-2012 e 2019-2023? Liste os 10 primeiros.
- `gt_gt220` **[RESULTADO≠]** — Qual a distribuicao mensal percentual das internacoes respiratorias e nao respiratorias? Considere a data de internação (entrada).
- `gt_gt225` **[RESULTADO≠]** — Qual a taxa de mortalidade por sexo e faixa etaria nas internacoes por COVID ou coronavirus?
- `gt_gt226` **[RESULTADO≠]** — Quais procedimentos cobrem 80% dos procedimentos em internacoes com UTI?
- `gt_gt227` **[RESULTADO≠]** — Quais sao os 3 procedimentos mais realizados por sexo e faixa etaria?
- `gt_gt230` **[RESULTADO≠]** — Qual o custo medio por dia calendario de internacao por especialidade e desfecho de morte?
- `gt_gt231` **[RESULTADO≠]** — Qual percentual de internacoes possui diagnostico secundario preenchido por ano e por desfecho?
- `gt_gt232` **[RESULTADO≠]** — Quantos registros com idade zero parecem inconsistentes com data de nascimento e data de internacao por ano?
- `gt_gt234` **[RESULTADO≠]** — Quais capitulos CID concentram mais internacoes de alto custo acima do percentil 99 do valor total?

---

O detalhe caso a caso — SQL previsto, linhas devolvidas, erros — está em
`relatorio.json`, ao lado deste arquivo.
