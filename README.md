# Chatbot Text-to-SQL — SIH/SUS

Chatbot que responde perguntas em português sobre **144.386.772 internações
hospitalares do SUS** (2007-2023, base SIH-RD do DATASUS, 15,4 GB em DuckDB).

O ciclo é: pergunta → SQL → execução → resposta em linguagem natural.

```
você › Qual a taxa de mortalidade de quem passou pela UTI?

SELECT CASE WHEN MARCA_UTI > 0 THEN 'usou UTI' ELSE 'nao usou UTI' END AS grupo,
       COUNT(*) AS internacoes,
       ROUND(100.0 * AVG(MORTE::INT), 2) AS taxa_mortalidade_pct
FROM internacoes GROUP BY 1

grupo          internacoes   taxa_mortalidade_pct
usou UTI         9.107.197                  23,05
nao usou UTI   135.279.575                   2,79

Resposta: Quem passou pela UTI morre 8,2 vezes mais: 23,05% contra 2,79%.
São 9.107.197 internações com UTI (6,3% do total) …
```

## Instalação

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

O `.env` precisa de:

```
DATABASE_PATH=duckdb:////caminho/para/sihrd5.duckdb?access_mode=read_only
OPENAI_API_KEY=sk-...
```

## Uso

Modo interativo:

```bash
.venv/bin/python -m src.cli
```

Pergunta única:

```bash
.venv/bin/python -m src.cli "Quais os 10 diagnósticos mais frequentes?"
```

SQL direto, sem passar pelo LLM (útil para depurar):

```bash
.venv/bin/python -m src.cli --sql "SELECT COUNT(*) FROM internacoes"
```

## Arquitetura

```
pergunta
   │
   ├─ 1. value linking ........ busca os termos da pergunta nas dimensões
   │                            (cid, procedimentos, municipios) e injeta os
   │                            CÓDIGOS REAIS no prompt
   │
   ├─ 2. geração de SQL ....... LLM recebe schema + domínios + REGRAS CRÍTICAS
   │                            e devolve JSON estruturado
   │                            {answerable, sql, reasoning, assumptions}
   │
   ├─ 3. validação ............ só SELECT/WITH · statement único · sem tabela
   │                            proibida · LIMIT injetado · EXPLAIN como
   │                            ensaio antes de varrer 144M linhas
   │
   ├─ 4. execução ............. DuckDB read-only, timeout de 120s
   │                            erro → auto-correção (até 2 tentativas)
   │
   └─ 5. síntese .............. LLM redige a resposta a partir do resultado,
                               obrigado a incluir as ressalvas aplicáveis
                               (SP/TO, raça/cor, 2007, valores nominais)
```

No modo interativo a `ChatSession` guarda as 3 últimas rodadas (pergunta + SQL),
o que faz perguntas de acompanhamento funcionarem:

```
você › Quantas internações de mulheres houve em 2019?     → 5.639.716
você › E em 2020?                                          → 4.832.685
você › Agora quebre por UF.                                → 27 linhas, MG no topo
```

A avaliação usa `TextToSQLAgent.ask` diretamente, sem histórico, para que cada
caso seja independente.

| Arquivo | Papel |
|---|---|
| `knowledge/schema.yaml` | **dicionário de dados curado** — schema, domínios, armadilhas |
| `src/schema_context.py` | renderiza o dicionário no prompt |
| `src/value_linker.py` | liga termos da pergunta a códigos reais das dimensões (ver nota abaixo) |
| `src/agent.py` | orquestra o pipeline |
| `src/db.py` | conexão read-only e validação de SQL |
| `src/cli.py` | interface de linha de comando |
| `eval/ground_truth.yaml` | 57 pares pergunta / SQL de referência |
| `eval/build_gold.py` | executa e snapshota os resultados de referência |
| `eval/run_eval.py` | mede execution accuracy |
| `docs/PROFILING.md` | perfilagem completa que embasa o dicionário |

### Value linking: por que ele existe e como quase estragou tudo

Sem value linking o modelo inventa códigos plausíveis: pede-se "pneumonia" e ele
escreve `DIAG_PRINC = 'J18'`, que pega só o código genérico e perde
`J180`-`J189`. O linker busca os termos da pergunta nas dimensões e mostra os
códigos que existem de verdade.

A primeira versão fazia isso com `LIKE '%termo%'` e o prompt dizia "use estes
códigos, não invente". A avaliação pegou o estrago: em *"qual a média de dias de
permanência?"*, o termo `dias` casou por substring dentro de "clami**dias**",
"me**dias**tino" e "hipospá**dias**"; o termo `base` (de "em toda a base") casou
em "vasos da base". O modelo obedeceu e filtrou por esses CIDs, devolvendo 18,42
dias em vez de 5,06 — **um número errado, sem erro de SQL, com aparência de
certo**.

Duas correções, ambas necessárias:

1. **Fronteira de palavra** (`\b` no RE2 do DuckDB) em vez de substring, mais uma
   lista de vocabulário analítico (`média`, `total`, `dias`, `base`, `custo`…)
   que nunca deve ser buscado nas dimensões.
2. **Sugerir em vez de mandar.** O bloco de dicas agora diz explicitamente para
   descartar o que não corresponder à pergunta.

Hoje, *"média de dias de permanência"* não gera dica nenhuma e *"infarto agudo do
miocárdio"* gera exatamente `I21`.

### Por que um dicionário curado, e não schema cru

Jogar `DESCRIBE` no prompt não funciona nesta base. A perfilagem
(`docs/PROFILING.md`) achou armadilhas que produzem **resultado errado sem dar
erro** — o pior modo de falha possível num chatbot analítico:

| Armadilha | O que acontece sem o dicionário |
|---|---|
| `SEXO = 2` para "mulheres" | retorna **zero linhas**: o fato só tem 1 e 3, e a dimensão mapeia 2 e 3 para 'Feminino' |
| `DIAG_PRINC = 'J18.9'` | retorna zero: os CIDs no banco não têm ponto (`'J189'`) |
| `NO_MUNICIPIO = 'Sao Paulo'` | retorna zero: os nomes **têm** acento (`'São Paulo'`) |
| `JOIN tempo ON DT_SAIDA = data` | descarta 2007 em silêncio: a dimensão começa em 2008 |
| ranking de UF | SP e TO estão **ausentes** da base por falha de extração |
| `WHERE GESTRISCO` | 99,6% das linhas, incluindo 58,8 milhões de homens |
| `AVG(UTI_INT_TO)` | ~0: a coluna está zerada em 9.107.168 das 9.107.197 internações com UTI |
| `hospital`, `socioeconomico` | tabelas **vazias** — nome de hospital, população e leitos não existem |

## Avaliação

O critério é **execution accuracy**: comparar o texto do SQL não serve, porque a
mesma pergunta admite muitas queries corretas e diferentes. Comparamos o
resultado da execução contra o resultado do SQL de referência, tolerando
arredondamento de float e permutação de colunas; a ordem das linhas só é exigida
nos casos marcados `ordered: true` (rankings).

SQL certo nem sempre é resposta certa. Um ranking de UF pode estar
aritmeticamente perfeito e ainda assim enganar, se apresentar São Paulo como o
estado com menos internações. Por isso alguns casos trazem
`answer_must_mention`: uma lista de ressalvas que o texto da resposta **precisa**
conter para o caso contar como acerto. Cada item é um conjunto de sinônimos —
basta um aparecer.

```yaml
answer_must_mention:
  - ["são paulo", "sp"]
  - ["subrepresent", "incompleto", "falha de extração"]
```

```bash
.venv/bin/python -m eval.build_gold          # (re)gera os resultados de referência
.venv/bin/python -m eval.run_eval            # avalia os 57 casos
.venv/bin/python -m eval.run_eval --category armadilha
.venv/bin/python -m eval.run_eval --model gpt-5
.venv/bin/python -m eval.rescore             # rejulga um relatório antigo sem gastar API
```

### Resultado no conjunto ampliado (272 casos)

Depois de validar e incorporar o conjunto externo `ground_truth_228.json`, o
ground truth passou de 57 para **272 casos** (237 respondíveis, 35 de recusa).

| | 272 casos |
|---|---|
| Acurácia geral | **205/272 — 75,4%** |
| SQL executável | 235/237 — 99,2% |
| Recusa correta | 26/35 — 74,3% |

> Os 205 combinam 179 confirmados na última execução completa com 26 recuperados
> ao reavaliar as mesmas predições depois de corrigir o avaliador e 14 golds.
> Uma execução limpa dos 272 ainda não foi feita.

**A média esconde uma divisão nítida.** Mesmo sistema, mesma execução:

| Origem do caso | Acurácia |
|---|---|
| 57 escritos e conferidos à mão neste projeto | **89,5%** |
| 215 importados do conjunto externo | **59,5%** |

Trinta pontos de diferença não são variação do modelo — são qualidade de
ground truth. A inspeção das 93 falhas mostra que a maioria vem de perguntas
**sub-especificadas**, onde mais de uma resposta é defensável:

- *"Quais capítulos CID têm maior custo total?"* — quantas linhas? O gold trazia
  `LIMIT 10` arbitrário; o modelo devolveu 20.
- *"Qual o custo médio de UTI por faixa etária?"* — quais faixas? O gold usou
  <18/<60/60+; o modelo usou décadas.
- *"Qual a taxa de mortalidade no RS em 2021?"* — o gold devolvia internações,
  óbitos **e** taxa; o modelo devolveu só a taxa, que é o que foi perguntado.

Nas categorias em que a pergunta é inequívoca, o desempenho se mantém alto:
`armadilha` 10/10, `dado_corrompido` 3/3, `filtro` 88%, `agregacao_simples` 83%.

A lição de engenharia: **um conjunto de avaliação grande e frouxo mede menos que
um conjunto pequeno e preciso.** Antes de crescer o ground truth, cada pergunta
precisa admitir uma única resposta correta — número de linhas, faixas e colunas
de saída incluídos.

### Resultado no conjunto original (gpt-5-mini, 57 casos, 15 min)

| Métrica | |
|---|---|
| **Acurácia geral** | **54/57 — 94,7%** |
| Execution accuracy (casos respondíveis) | 46/49 — 93,9% |
| SQL executável na 1ª tentativa | 49/49 — 100% |
| Recusa correta (irrespondível + dado corrompido) | 8/8 — 100% |

Por categoria: `armadilha` 10/10, `join_dimensao` 10/10, `taxa` 7/7,
`temporal` 6/6, `agregacao_simples` 4/4, `filtro` 3/3, `dado_corrompido` 3/3,
`irrespondivel` 6/6, `agregacao_complexa` 4/5, `dominio` 1/3.

Modos de casamento: 30 exatos, 14 superset (predição com colunas a mais),
2 com rótulo equivalente, 3 falhas.

**As 10 armadilhas passaram todas.** O modelo não escreveu `SEXO = 2`, não
procurou `'J18.9'` com ponto, não fez INNER JOIN com `tempo`, excluiu 2007 das
comparações de ano completo e achou `'São Paulo'` com acento. E recusou as 8
perguntas sem resposta na base em vez de inventar número.

### As 3 falhas

| Caso | O que houve |
|---|---|
| `cid_infarto_2023` | O modelo somou `I21` **e** `I22` (infarto recorrente); a pergunta era só infarto agudo. 118.123 contra 115.672. **Erro real.** |
| `proc_partos_cesarea_vs_normal` | Casou `'%PARTO%'` e varreu tratamento de eclâmpsia e traumatismo de parto no neonato: 379.424 internações a mais que não são partos. **Erro real.** |
| `multi_mortalidade_faixa_sexo` | Usou `'<1 ano'` e `'1-14 anos'` onde a pergunta pedia `'menores de 1 ano'` e `'1 a 14'`. Os 8 pares (internações, taxa) são **idênticos** — divergência só no texto do rótulo. |

Os dois erros reais têm a mesma causa: casamento textual amplo demais ao mapear
um conceito clínico para códigos. É o eixo mais fraco do sistema
(`dominio` 1/3) e o próximo lugar a atacar — provavelmente estreitando o value
linker para propor o código exato em vez de deixar o modelo montar padrões
`ILIKE`.

### Como a métrica foi construída (e por que a primeira estava errada)

A primeira rodada deu **34/57 (59,6%)** — e o número era falso. Ele media a
rigidez do avaliador, não a correção do modelo:

1. **Sem tolerância numérica.** `ROUND(SUM(VAL_TOT),2)` devolve `…278,02` numa
   execução e `…278,07` na seguinte: somar 144 milhões de doubles em ordens de
   thread diferentes não é determinístico. Igualdade exata de float media o
   escalonamento de threads do DuckDB.
2. **Exigia forma idêntica.** A predição `03, Parda, 55.944.720, 38,75%` era
   reprovada contra o gold `Parda, 55.944.720` — por ser mais informativa.
3. **Sete golds meus estavam errados.** "Qual ano teve menos internações"
   exigia ano *e* contagem; `cid_por_capitulo` usava `INNER JOIN` contrariando a
   regra que eu mesmo escrevi no dicionário; `proc_partos` ignorava as variantes
   de alto risco (1,2 milhão a menos).

O critério final é `gold ⊆ predição`: cada coluna do gold precisa achar uma
coluna distinta na predição, **e as linhas precisam se corresponder**. Trocar as
contagens entre dois grupos continua reprovando.

O que o avaliador tolera, e por quê:

| Tolerância | Motivo |
|---|---|
| Colunas extras na predição | `03, Parda, 55.944.720, 38,75%` responde tudo que `Parda, 55.944.720` responde |
| Nome das colunas | um `AS` diferente não muda a resposta; só valores são comparados |
| Maiúsculas e acentos | `'SAO PAULO'` e `'São Paulo'` são o mesmo município |
| Número escrito como texto | `RACA_COR` é VARCHAR: `'03'` e `3` são o mesmo valor |
| Precisão decimal | 5,0631 contra 5,06 passa; 5,06 contra 5,08 não |
| Arredondamento | o `round()` do Python usa banker's rounding e o DuckDB não — 5,125 vira 5,12 num e 5,13 no outro |
| Ruído de soma paralela | somar 144M de doubles devolve `…278,02` e `…278,07` entre execuções da MESMA query |
| Linhas "Não informado" | incluir ou não a categoria vazia é escolha de apresentação; sai dos dois lados antes de comparar |
| Rótulos equivalentes | `'<1 ano'` e `'menor de 1 ano'` nomeiam o mesmo grupo — os números do rótulo é que o definem |

### O conjunto de ground truth

57 casos escritos e conferidos à mão, distribuídos por eixo de capacidade:

| Categoria | Casos | O que exercita |
|---|---:|---|
| `agregacao_simples` | 4 | COUNT/SUM/AVG sem filtro |
| `temporal` | 6 | recorte por ano/mês, séries, sazonalidade |
| `filtro` | 3 | filtros numéricos e booleanos |
| `join_dimensao` | 10 | junções com dimensões e rótulos legíveis |
| `taxa` | 7 | razões, percentuais, `HAVING` de volume mínimo |
| `agregacao_complexa` | 5 | múltiplas quebras, window functions, comparação entre períodos |
| `dominio` | 3 | mapear termo clínico → código (pneumonia → J18, infarto → I21) |
| `armadilha` | 10 | os casos da tabela acima |
| `dado_corrompido` | 3 | reconhecer `GESTRISCO`, `UTI_INT_TO`, SP/TO |
| `irrespondivel` | 6 | recusar o que a base não tem |

Um terço dos casos (19 de 57) testa comportamento sob dados ruins ou ausentes —
não a capacidade de escrever `GROUP BY`. É onde um chatbot de text-to-SQL
realmente falha em produção.

Os casos `irrespondivel` e `dado_corrompido` não têm SQL de referência: o acerto
é o agente marcar `answerable=false` e explicar o que falta. Responder com um
número inventado conta como erro.

## Segurança

- conexão DuckDB aberta em `access_mode=read_only` — o próprio engine recusa escrita;
- validação estática antes de executar: apenas `SELECT`/`WITH`, um único
  statement, nenhuma palavra-chave de DDL/DML, nenhuma tabela proibida;
- `LIMIT` injetado automaticamente em consultas não agregadas;
- timeout de 120s por query;
- `EXPLAIN` como ensaio, para erros de sintaxe/coluna não custarem uma varredura
  de 144 milhões de linhas.

## Limitações conhecidas

- **SP e TO não são analisáveis** — ver `docs/PROFILING.md` §4.4.
- **Não há dados de hospital** — só o código CNES; `hospital` está vazia. Toda
  geografia é do município de **residência do paciente**, não do local do
  atendimento.
- **Não há identificador de paciente** — reinternação e trajetória não são rastreáveis.
- **Valores não são deflacionados** — `VAL_TOT` é nominal.
- **Raça/cor tem 29,2% de "Sem informação"**.
- A base é de AIH **faturada**; internações não faturadas não aparecem.
