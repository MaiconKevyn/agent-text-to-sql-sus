# Execução 3

- **quando** 2026-08-01T20:35:40
- **modelo** `gpt-5-mini`
- **comando** `python -m eval.run_eval `

## Resultado

| | |
|---|---|
| Acurácia geral | 198/272 (72.8%) |
| Execution accuracy | 174/237 (73.4%) |
| Recusa correta | 24/35 (68.6%) |

## Por categoria

| categoria | acertos |
|---|---|
| agregacao_complexa | 17/44 (38.6%) |
| taxa | 12/21 (57.1%) |
| dominio | 2/3 (66.7%) |
| irrespondivel | 22/33 (66.7%) |
| join_dimensao | 38/53 (71.7%) |
| temporal | 19/24 (79.2%) |
| filtro | 52/58 (89.7%) |
| agregacao_simples | 23/23 (100.0%) |
| armadilha | 10/10 (100.0%) |
| dado_corrompido | 3/3 (100.0%) |

## Falhas · 74

- `proc_partos_cesarea_vs_normal` **[RESULTADO≠]** — Quantos partos normais e quantas cesáreas foram realizados, somando todas as variantes desses procedimentos?
- `uti_mortalidade_comparada` **[RESULTADO≠]** — A mortalidade é maior entre quem passou pela UTI? Compare quem usou e quem não usou.
- `unans_municipio_hospital` **[NÃO RECUSOU]** — Quantas internações foram realizadas em hospitais localizados no Rio de Janeiro?
- `gt_gt005` **[NÃO RECUSOU]** — Quantos hospitais estão cadastrados?
- `gt_gt014` **[RESULTADO≠]** — Quantas internações por meningite ocasionaram em morte?
- `gt_gt028` **[RESULTADO≠]** — Quais sao os 10 municípios com mais de 100 internações com a maior taxa de mortalidade?
- `gt_gt029` **[RESULTADO≠]** — Qual é o valor médio de UTI para homens?
- `gt_gt040` **[NÃO RECUSOU]** — Qual a taxa de mortalidade infantil média no Brasil?
- `gt_gt044` **[RESULTADO≠]** — Qual o custo médio de UTI por faixa etária dos pacientes?
- `gt_gt065` **[RESULTADO≠]** — Qual o nível de instrução dos pacientes internados?
- `gt_gt076` **[NÃO RECUSOU]** — Quais são os 10 municípios que atendem mais pacientes?
- `gt_gt077` **[RESULTADO≠]** — Qual a média de dias de internação por município?
- `gt_gt078` **[EXCEÇÃO]** — Quais são os 10 principais motivos de internação para pacientes com menos de 18 anos, entre 18 e 64 anos, e acima de 64 anos?
- `gt_gt083` **[RESULTADO≠]** — Qual é a taxa de mortalidade por nível de instrução no estado do RS, considerando apenas grupos com mais de 1000 internações?
- `gt_gt084` **[RESULTADO≠]** — Quais são os 3 procedimentos mais comuns entre internações que resultaram em óbito para cada faixa etária: menor de 18, 18 a 64, e 65 ou mais?
- `gt_gt086` **[NÃO RECUSOU]** — Quais são os 3 hospitais com maior custo médio de UTI por estado (MA e RS)?
- `gt_gt087` **[RESULTADO≠]** — Qual a evolução anual da taxa de mortalidade por estado (MA e RS)?
- `gt_gt090` **[RESULTADO≠]** — Quais são os 10 diagnósticos com maior média de dias de internação (com mais de 10000 casos)?
- `gt_gt091` **[NÃO RECUSOU]** — Quais são os 5 hospitais mais eficientes em custo por dia de internação (com mais de 1000 internações)?
- `gt_gt099` **[RESULTADO≠]** — Qual o total gasto em internações de UTI?
- `gt_gt115` **[RESULTADO≠]** — Qual o hospital com maior receita total por especialidade médica, considerando apenas hospitais com mais de 500 internações na especialidade?
- `gt_gt117` **[RESULTADO≠]** — Qual a razão entre internações masculinas e femininas em UTI por ano, considerando apenas internações cirúrgicas (ESPEC = 1)?
- `gt_gt120` **[RESULTADO≠]** — Qual o total e o percentual de internações por doenças respiratórias (CID J%) em cada trimestre do ano no estado do RS? Considere a data de internação (entrada).
- `gt_gt121` **[RESULTADO≠]** — Quais municípios com mais de 500 internações aparecem simultaneamente no top-20 de volume e no top-20 de taxa de mortalidade nos estados MA e RS?
- `gt_gt122` **[RESULTADO≠]** — Quais procedimentos, ordenados por volume decrescente, cobrem até 80% do total de atendimentos realizados?
- `gt_gt124` **[RESULTADO≠]** — Qual a média móvel de 3 anos de internações no estado do RS por ano (2008-2023)?
- `gt_gt125` **[RESULTADO≠]** — Qual a distribuição e percentual de internações em UTI por dia da semana?
- `gt_gt126` **[RESULTADO≠]** — Como se distribuem os hospitais em quartis de volume de internações? Mostre o número de hospitais e o intervalo de internações por quartil.
- `gt_gt128` **[RESULTADO≠]** — Quais são os 10 municípios com mais de 1000 internações que têm taxa de internação em UTI mais de duas vezes acima da média nacional?
- `gt_gt129` **[RESULTADO≠]** — Quais códigos CID aparecem como diagnóstico principal em óbitos registrados?
- `gt_gt130` **[RESULTADO≠]** — Quais são os 10 municípios com maior taxa de mortalidade em internações obstétricas, entre aqueles com mais de 200 internações obstétricas e taxa acima da média nacional obstétrica?
- `gt_gt132` **[NÃO RECUSOU]** — Quais os 3 hospitais com maior valor médio de serviço hospitalar (VAL_SH) por estado (MA e RS), considerando hospitais com mais de 500 internações?
- `gt_gt134` **[RESULTADO≠]** — Qual a média de dias de internação por especialidade médica, comparando lado a lado os estados MA e RS?
- `gt_gt140` **[RESULTADO≠]** — Quantas internacoes por COVID ou coronavirus foram registradas?
- `gt_gt141` **[RESULTADO≠]** — Quantas internacoes por diabetes foram registradas?
- `gt_gt166` **[RESULTADO≠]** — Quantos registros de procedimento estao sem codigo de procedimento realizado?
- `gt_gt171` **[RESULTADO≠]** — Qual a taxa de mortalidade por complexidade assistencial?
- `gt_gt173` **[RESULTADO≠]** — Quais sao os 10 CIDs de infarto agudo do miocardio mais frequentes nas internacoes?
- `gt_gt174` **[RESULTADO≠]** — Quais capitulos CID aparecem com maior volume de internacoes?
- `gt_gt181` **[RESULTADO≠]** — Qual a evolucao anual das internacoes por doencas respiratorias?
- `gt_gt182` **[RESULTADO≠]** — Qual a evolucao anual de internacoes e mortes por COVID ou coronavirus?
- `gt_gt185` **[NÃO RECUSOU]** — Quais sao os 10 hospitais com maior volume de internacoes em UTI?
- `gt_gt190` **[NÃO RECUSOU]** — Quais municipios tiveram maior taxa de mortalidade infantil em 2021?
- `gt_gt191` **[RESULTADO≠]** — Quais nacionalidades aparecem com maior volume de internacoes? Liste os 10 primeiros.
- `gt_gt193` **[RESULTADO≠]** — Qual a taxa de mortalidade por nivel de instrucao?
- `gt_gt195` **[RESULTADO≠]** — Qual a evolução anual das internações com registro de exame VDRL?
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
- `gt_gt209` **[NÃO RECUSOU]** — Qual hospital tem maior taxa de mortalidade por especialidade, considerando apenas combinacoes com mais de 1000 internacoes?
- `gt_gt210` **[RESULTADO≠]** — Qual procedimento mais frequente em cada capitulo CID?
- `gt_gt211` **[RESULTADO≠]** — Qual percentual de internacoes de cada ano entre 2019 e 2023 foi por capitulo CID?
- `gt_gt213` **[RESULTADO≠]** — Como a taxa de mortalidade compara internacoes de urgencia e eletivas por faixa etaria?
- `gt_gt214` **[NÃO RECUSOU]** — Quais hospitais com mais de 5000 internacoes tem custo medio e taxa de mortalidade acima da media geral?
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
