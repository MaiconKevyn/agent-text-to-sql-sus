<div align="center">

# Consulta SIH/SUS

**Pergunte em português sobre 144 milhões de internações hospitalares do SUS.**

O agente traduz a pergunta em SQL, executa no DuckDB, desenha o gráfico e
responde — mostrando a consulta, os dados e as ressalvas.

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![DuckDB](https://img.shields.io/badge/DuckDB-15,4_GB-FFF000?logo=duckdb&logoColor=black)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-SSE-009688?logo=fastapi&logoColor=white)
![ECharts](https://img.shields.io/badge/Apache_ECharts-5-AA344D)

[Como funciona](#como-funciona) · [Instalação](#instalação) · [Funcionalidades](#funcionalidades) · [Avaliação](#avaliação) · [Limitações](#limitações-conhecidas)

<img src="docs/img/02-resposta-com-grafico.png" alt="Resposta do agente com gráfico, SQL e tabela" width="880">

</div>

---

## O problema

A base SIH-RD do DATASUS tem **144.386.772 internações** entre 2007 e 2023,
15,4 GB em DuckDB. Ela responde perguntas que interessam a pesquisadores e
gestores de saúde — e está cheia de armadilhas que produzem respostas **erradas
com cara de certas**:

| Armadilha | O que acontece com quem não sabe |
|---|---|
| `SEXO` só contém os valores `1` e `3` | filtrar `SEXO = 2` para "feminino" devolve zero |
| COVID está em `B342`, não em `U07` | perguntar por COVID devolve zero, e o zero parece resposta |
| SP tem 88 mil internações; RR tem 598 mil | um ranking por UF sugere que São Paulo quase não interna |
| `CID_MORTE` deixa de ser preenchida em 2015 | uma série de causas de óbito despenca a zero e parece tendência |
| `GESTRISCO` é `TRUE` em 99,6% das linhas | qualquer recorte por "gestação de risco" é ruído |

O trabalho central deste projeto não foi o text-to-SQL. Foi **descobrir e
documentar essas armadilhas** num dicionário curado que entra no prompt, e
construir uma avaliação que prova que elas não voltam.

---

## Como funciona

```mermaid
flowchart LR
    P["Pergunta<br/>em português"] --> VL

    subgraph pipeline[" "]
        direction TB
        VL["<b>1 · Value linking</b><br/>procura códigos reais<br/>nas dimensões"]
        VL --> GEN["<b>2 · Geração de SQL</b><br/>saída estruturada:<br/>SQL, suposições, gráfico"]
        GEN --> VAL["<b>3 · Validação estática</b><br/>só SELECT, um statement,<br/>LIMIT de segurança"]
        VAL --> EXE["<b>4 · Execução</b><br/>DuckDB read-only<br/>com timeout"]
        EXE --> SIN["<b>5 · Síntese</b><br/>resposta em linguagem<br/>natural, com ressalvas"]
    end

    DIC[("<b>Dicionário curado</b><br/>20 regras · 8 críticas")] -.->|entra no prompt| GEN
    EXE -.->|erro do DuckDB| REP["Auto-reparo<br/>até 2 tentativas"]
    REP -.-> VAL
    SIN --> R["Resposta + gráfico<br/>+ SQL + tabela"]

    style DIC fill:#0f8ba3,stroke:#0c6a7d,color:#fff
    style REP fill:#eda100,stroke:#c98500,color:#1b2430
    style R fill:#1baf7a,stroke:#199e70,color:#fff
```

O laço de auto-reparo é **sintático**: dispara quando o SQL levanta exceção.
Para perguntas que exigem mais de uma hipótese analítica existe o
[modo investigação](#modo-investigação).

### As duas decisões que sustentam o resto

**1. O dicionário curado substitui o dump do schema.**

Passar `CREATE TABLE` para o modelo informa que existe uma coluna `SEXO` do tipo
`TINYINT` — e não informa que ela só contém `1` e `3`. O arquivo
[`knowledge/schema.yaml`](knowledge/schema.yaml) descreve o que cada coluna
*significa*, o que está corrompido e o que não se deve fazer. São **20 regras,
8 críticas**, cada uma nascida de uma resposta errada observada.

**2. O modelo declara, o código executa.**

| O modelo produz | O código faz |
|---|---|
| a consulta SQL | valida, injeta `LIMIT`, executa em conexão read-only |
| a *forma* do gráfico e as colunas | monta a série a partir das linhas que o banco devolveu |
| um diagnóstico de 4 perguntas sim/não | deriva se as evidências bastam |

O gráfico nunca contém um número que a consulta não retornou, porque o modelo
não escreve pontos — só declara a forma.

---

## Instalação

**Requisitos:** Python 3.11+, Node 18+ e o arquivo `sihrd5.duckdb`.

```bash
git clone https://github.com/MaiconKevyn/agent-text-to-sql-sus.git
cd agent-text-to-sql-sus
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Crie o `.env` na raiz:

```env
DATABASE_PATH=duckdb:////caminho/absoluto/para/sihrd5.duckdb?access_mode=read_only
OPENAI_API_KEY=sk-...

# opcionais, com os valores padrão
SQL_MODEL=gpt-5-mini
ANSWER_MODEL=gpt-5-mini
QUERY_TIMEOUT_S=120
MAX_REPAIR_ATTEMPTS=2
```

### Rodando

**Terminal**, sem frontend:

```bash
.venv/bin/python -m src.cli
```

**Web**, dois processos:

```bash
# processo 1 — API
.venv/bin/python -m uvicorn src.api:app --port 8000

# processo 2 — interface
cd frontend && npm install && npm run dev
```

A interface sobe em `http://localhost:5173`.

<div align="center">

<img src="docs/img/01-inicio.png" alt="Tela inicial com sugestões de pergunta" width="880">

</div>

---

## Funcionalidades

### Resposta com gráfico, consulta e dados

O agente decide se um gráfico ajuda e qual forma usar. São sete formas — linha,
barra, barra horizontal, pizza, dispersão, heatmap e empilhada 100% — mais
`nenhum`, escolhido para resultado escalar ou quando as colunas numéricas têm
unidades diferentes.

Os gráficos usam **Apache ECharts** com uma paleta validada nos seis testes do
guia de dataviz, nos temas claro e escuro. Abaixo do texto vêm sempre a consulta
SQL gerada, a tabela paginada com exportação em CSV, e as suposições que o
agente registrou.

### Explorador do banco

<div align="center">

<img src="docs/img/03-schema.png" alt="Explorador de schema com tabelas, colunas e regras" width="880">

</div>

Tabelas, colunas com descrição e as regras críticas do dicionário. Clicar numa
tabela insere a referência no campo de pergunta.

### Modo investigação

Uma pergunta como *"existe relação entre X e Y?"* não se responde com uma
consulta só. O agente oferece o modo investigação, que roda várias consultas e
devolve um relatório navegável.

<div align="center">

<img src="docs/img/05-investigacao.png" alt="Painel de relatório da investigação" width="880">

</div>

```mermaid
flowchart TB
    Q["Pergunta investigativa"] --> PL
    PL["<b>Planejar</b><br/>quebra em 2-6 etapas,<br/>cada uma autocontida"] --> EX
    EX["<b>Executar</b><br/>etapas em paralelo;<br/>cada uma reusa o agente inteiro"] --> RF
    RF{"<b>Refletir</b><br/>4 perguntas objetivas —<br/>o código decide"}
    RF -->|defeito encontrado| AP["<b>Aprofundar</b><br/>1 consulta por defeito"]
    AP --> SI
    RF -->|argumento fechado| SI
    SI["<b>Sintetizar</b><br/>resposta, evidências<br/>e limitações"] --> REL["Relatório"]

    style RF fill:#eda100,stroke:#c98500,color:#1b2430
    style REL fill:#1baf7a,stroke:#199e70,color:#fff
```

Custo real medido: **~165 s e 8 chamadas ao modelo** por investigação. É um modo
que o usuário escolhe — o chip **oferece**, nunca dispara sozinho.

A reflexão não decide se as evidências bastam: ela responde quatro perguntas
objetivas (*uma etapa falhou? falta denominador? as evidências se contradizem?
alguma pergunta ficou sem resposta?*) e o código deriva a decisão. A versão
anterior deixava o modelo afirmar `suficiente: true` no mesmo retorno em que
descrevia um buraco real — **um schema que permite o modelo se contradizer vai
ser usado para isso.**

### Cada evidência declara o que mediu

<div align="center">

<img src="docs/img/06-evidencia.png" alt="Bloco de evidência com a definição operacional" width="620">

</div>

Todo bloco abre com **"O que foi medido"**: o recorte que a consulta aplicou, em
português, antes de qualquer número.

Isso existe porque uma versão anterior mediu "câncer" como `C00-C97` **mais**
`D00-D48` — que inclui neoplasia benigna e in situ — e rotulou o resultado
apenas como "câncer". O número estava certo e o rótulo errado, o que num painel
é pior: o gráfico circula sem a definição junto.

### Trace de depuração

<div align="center">

<img src="docs/img/04-debug-trace.png" alt="Trace de depuração mostrando o contexto montado" width="880">

</div>

Com o **Debug** ligado, cada resposta expõe o rastro completo: o prompt do
sistema com o dicionário renderizado (26.824 caracteres), os candidatos que o
value linking encontrou, o plano JSON do modelo, o SQL enviado ao DuckDB e as
tentativas de reparo.

### Perguntas de acompanhamento

A sessão guarda as três últimas rodadas (pergunta + SQL), então o contexto se
mantém:

```
você › Quantas internações de mulheres houve em 2019?     → 5.639.716
você › E em 2020?                                          → 4.832.685
você › Agora quebre por UF.                                → 27 linhas, MG no topo
```

---

## Arquitetura

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/arquitetura-dark.svg">
  <img src="docs/img/arquitetura.svg" alt="Arquitetura: interface React sobre API FastAPI com SSE; dois modos — o agente de uma consulta e a investigação de várias — apoiados no dicionário curado, no modelo e no DuckDB read-only" width="1000">
</picture>

</div>

Três camadas, dois modos e três fundações compartilhadas.

**A interface nunca fala com o banco.** Todo o caminho passa pela API, que
transmite por Server-Sent Events — uma pergunta leva ~40 s e uma investigação
passa de dois minutos; sem eventos de progresso a tela ficaria muda.

**Os dois modos compartilham o pipeline.** A fase `Executar` da investigação não
reimplementa nada: ela chama o mesmo `TextToSQLAgent`, então dicionário, value
linking e auto-reparo valem igual nas duas entradas.

**As três fundações servem aos dois.** O dicionário entra no prompt de toda
geração de SQL; o modelo é chamado com saída estruturada em JSON Schema; o
DuckDB é a mesma conexão read-only, aberta uma vez.

### Estrutura de arquivos

```
src/
  agent.py             pipeline; prompts de SQL e de resposta
  llm.py               chamadas à OpenAI, saída estruturada e streaming
  db.py                DuckDB read-only, validação de SQL, LIMIT, timeout
  value_linker.py      casa termos da pergunta com valores reais das dimensões
  schema_context.py    renderiza schema.yaml para o prompt
  cli.py               interface de linha de comando
  api.py               FastAPI + Server-Sent Events
  investigation/
    models.py          Etapa, Achado, Relatorio, Reflexao
    contracts.py       schemas de saída estruturada e prompts
    phases.py          planejar · executar · refletir
    report.py          síntese e serialização
    runner.py          orquestra e é o único dono do orçamento

knowledge/schema.yaml  o dicionário curado — o artefato central
eval/
  ground_truth.yaml    272 casos com SQL gold
  run_eval.py          execution accuracy com tolerância
  testa_graficos.py    escolha da forma do gráfico, ponta a ponta
  testa_reflexao.py    reflexão isolada, com evidências sintéticas
frontend/src/
  components/          chat, resultado, gráfico, schema, relatório
  hooks/               useChat, useInvestigation, useTheme
  lib/                 cliente SSE, tipos, tema dos gráficos
  scripts/             captura dos screenshots deste README
```

### Value linking: por que existe, e como quase estragou tudo

Sem value linking o modelo inventa códigos plausíveis: pede-se "pneumonia" e ele
escreve `J18` sem saber se existe. A camada busca os termos da pergunta nas
tabelas de dimensão e injeta os **códigos reais** no prompt.

Com value linking **ingênuo** — `LIKE '%termo%'` — acontece o que aconteceu
aqui: `%dias%` casou com "clamiDIAS" e "meDIAStino", `%base%` com "vasos da
base", o modelo filtrou por esses CIDs e respondeu **18,42 dias** de permanência
média em vez de **5,06**.

A correção foi casar por **limite de palavra** (`\b` do RE2 no DuckDB — não `\y`,
que é do PostgreSQL e não casa nada aqui), somar uma lista de palavras vazias
com vocabulário analítico, e apresentar os candidatos ao modelo como sugestões
descartáveis.

---

## Avaliação

O critério é **execution accuracy**: comparar o texto do SQL não serve, porque
existem muitas consultas corretas para a mesma pergunta. O avaliador roda o SQL
gold e o SQL previsto e compara os **resultados**, com:

- `gold ⊆ pred` — colunas a mais não invalidam, desde que a resposta esteja lá;
- tolerância numérica e comparação na precisão publicada;
- `Decimal.quantize(ROUND_HALF_UP)`, porque o arredondamento bancário do Python
  dá 5,12 onde o DuckDB dá 5,13 — e um valor em 131 derrubava um caso inteiro;
- descarte de linhas "Não informado" dos **dois** lados.

```bash
.venv/bin/python eval/run_eval.py --workers 4
```

| Conjunto ampliado — 272 casos | |
|---|---|
| **Acurácia geral** | **199/272 — 73,2%** |
| SQL executável | 230/237 — 97,0% |
| Recusa correta | 28/35 — 80,0% |

Números de **uma execução completa**, todos apurados do mesmo relatório. Vale
dizer o que isso corrige: a marca anterior de 75,4% somava 179 casos de uma
execução com 26 recuperados ao reavaliar predições antigas depois de consertar o
avaliador e 14 golds. Não era uma medição, era duas.

**Uma rodada isolada não distingue diferenças pequenas.** Reexecutando só os 73
casos que falharam, sem mudar uma linha de código, **11 passaram na segunda
tentativa** — 15% do conjunto de falhas é instável. Na prática: variação de até
uns 4 pontos entre execuções é ruído do modelo, não sinal. Comparações que
dependam de menos que isso precisam de mais de uma rodada.

**A média esconde uma divisão nítida.** Mesmo sistema, mesma execução:

| Origem do caso | Acurácia |
|---|---|
| 57 escritos e conferidos à mão neste projeto | **96,5%** |
| 215 importados de um conjunto externo | **67,0%** |

Trinta pontos não são variação do modelo — são **qualidade de ground truth**. A
maioria das falhas vem de perguntas sub-especificadas, em que mais de uma
resposta é defensável: *"quais capítulos CID têm maior custo?"* não diz quantas
linhas, e o gold trazia um `LIMIT 10` arbitrário.

A lição de engenharia: **um conjunto de avaliação grande e frouxo mede menos que
um pequeno e preciso.** Nas categorias em que a pergunta é inequívoca o
desempenho se mantém alto — `armadilha` 10/10, `dado_corrompido` 3/3,
`agregacao_simples` 22/23, `filtro` 86%.

O ponto fraco é nítido e não é ambiguidade de enunciado: **`agregacao_complexa`,
17/44 — 38,6%**, a pior categoria e a terceira maior. São as perguntas com
janela, percentil, média móvel ou comparação entre dois recortes na mesma
consulta. É aí que vale trabalhar.

### Outros testes

```bash
.venv/bin/python eval/testa_graficos.py      # 7/7 — forma do gráfico, ponta a ponta
.venv/bin/python eval/testa_reflexao.py      # 3/3 — reflexão, sem tocar o banco
```

---

## Segurança

- Conexão DuckDB em **read-only**; nenhuma escrita é possível.
- Validação estática antes de executar: só `SELECT`/`WITH`, um único statement,
  tabelas de staging bloqueadas.
- `EXPLAIN` como ensaio, para pegar erro de sintaxe ou coluna inexistente sem
  varrer 144 milhões de linhas.
- `LIMIT` injetado quando ausente; timeout que interrompe o cursor.
- A interface trabalha **só com agregados** — nenhuma informação individual de
  paciente é exibida.

---

## Limitações conhecidas

**Da base**, e nenhuma engenharia resolve:

- A unidade é a **internação**, não a pessoa. Reinternações contam várias vezes,
  e não existe identificador de paciente.
- **Não há denominador populacional.** Nada de incidência, prevalência ou risco
  por 100 mil habitantes — só participação nas internações.
- Não há como estabelecer **causa**, apenas associação entre colunas.
- SP e TO estão gravemente sub-representados por falha de extração.
- `CID_MORTE` e `DIAG_SECUN` deixam de ser preenchidas a partir de 2015.

**Do sistema**, e são trabalho pendente:

- A reflexão da investigação está provada em teste isolado (3/3 com evidências
  sintéticas), mas **ainda não disparou numa investigação real**: nos casos
  testados o plano inicial já vinha completo.
- `agregacao_complexa` fica em 38,6%. Não é ruído nem ambiguidade de enunciado —
  é limite real do sistema em consultas com janela, percentil e média móvel.
- A acurácia é de **uma** execução, e o modelo varia: 15% das falhas passam numa
  segunda tentativa. O número tem uma margem de uns 4 pontos.

---

## Documentos

| | |
|---|---|
| [`docs/PROFILING.md`](docs/PROFILING.md) | o levantamento do banco que originou o dicionário |
| [`knowledge/schema.yaml`](knowledge/schema.yaml) | as 20 regras, cada uma com a evidência que a motivou |
| [`eval/ground_truth.yaml`](eval/ground_truth.yaml) | os 272 casos com SQL gold |
| [`docs/gera_arquitetura.py`](docs/gera_arquitetura.py) | gera o diagrama acima, nas versões clara e escura |

---

<div align="center">
<sub>

Os screenshots deste README são capturados contra a aplicação real por
[`frontend/scripts/screenshots.mjs`](frontend/scripts/screenshots.mjs) —
o script digita as perguntas na interface e espera o agente responder, então os
números nas imagens vieram do DuckDB.

</sub>
</div>
