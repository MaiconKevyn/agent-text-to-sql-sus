<div align="center">

# Consulta SIH/SUS

**Pergunte em português sobre 144 milhões de internações hospitalares do SUS.**

Três ferramentas sobre a mesma base: um **chat** que traduz a pergunta em SQL e
responde com gráfico; **temas** de investigação que acumulam evidência com
procedência; e **painéis** com filtros que recalculam tudo ao vivo — todos
construíveis em linguagem natural.

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![DuckDB](https://img.shields.io/badge/DuckDB-15,4_GB-FFF000?logo=duckdb&logoColor=black)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-SSE-009688?logo=fastapi&logoColor=white)
![ECharts](https://img.shields.io/badge/Apache_ECharts-5-AA344D)

[Começar em 5 minutos](#começar-em-5-minutos) · [As três ferramentas](#as-três-ferramentas) · [Como funciona](#como-funciona) · [Avaliação](#avaliação) · [Limitações](#limitações-conhecidas)

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

## Começar em 5 minutos

### 1. O que você precisa

| | |
|---|---|
| **Python 3.11+** | `python3 --version` |
| **Node 18+** | `node --version` |
| **`sihrd5.duckdb`** | o banco, 15,4 GB — não vai no repositório |
| **Chave da OpenAI** | qualquer conta com crédito |

### 2. Clonar e instalar

```bash
git clone https://github.com/MaiconKevyn/agent-text-to-sql-sus.git
cd agent-text-to-sql-sus

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd frontend && npm install && cd ..
```

### 3. Configurar

Crie um arquivo `.env` **na raiz do projeto**:

```env
# obrigatórios
DATABASE_PATH=duckdb:////caminho/absoluto/para/sihrd5.duckdb?access_mode=read_only
OPENAI_API_KEY=sk-...

# opcionais — estes são os valores padrão
SQL_MODEL=gpt-5-mini
ANSWER_MODEL=gpt-5-mini
QUERY_TIMEOUT_S=120
MAX_REPAIR_ATTEMPTS=2

# opcional — liga a busca web nos temas (fontes oficiais e científicas)
TAVILY_API_KEY=tvly-...
```

> **As quatro barras não são erro de digitação.** `duckdb:////caminho` — o
> esquema pede duas, e o caminho absoluto começa com a sua própria barra. Com
> três, o DuckDB procura um caminho relativo e falha dizendo que o arquivo não
> existe.

> **`access_mode=read_only` é o que garante que nada será escrito.** Sem ele, o
> DuckDB abre para escrita e cria um arquivo `.wal` ao lado do banco.

### 4. Subir os dois processos

A interface e a API são separadas, e **as duas precisam estar de pé**. Abra dois
terminais:

```bash
# terminal 1 — a API (deixe rodando)
.venv/bin/python -m uvicorn src.api:app --port 8000
```

```bash
# terminal 2 — a interface (deixe rodando)
cd frontend && npm run dev
```

Abra **http://localhost:5173**. É esta a primeira tela:

<div align="center">
<img src="docs/img/01-inicio.png" alt="Tela inicial com sugestões de pergunta e a barra de seções à esquerda" width="880">
</div>

Para conferir que a API subiu antes de abrir a interface:

```bash
curl http://localhost:8000/api/health
# {"ok":true,"internacoes":144386772,"model":"gpt-5-mini",...}
```

<details>
<summary><b>Não subiu? Os quatro erros mais comuns</b></summary>

| Sintoma | Causa | Conserto |
|---|---|---|
| `/api/health` devolve `"ok": false` com erro de arquivo | caminho do banco errado | confira as **quatro barras** e use caminho absoluto |
| A interface abre mas diz "o backend não respondeu" | a API não está de pé, ou está em outra porta | suba o terminal 1; se mudou a porta, ajuste `VITE_API_URL` |
| `OPENAI_API_KEY não configurada` | o `.env` está na pasta errada | tem de estar na **raiz**, não em `frontend/` |
| A busca web recusa com 503 | falta `TAVILY_API_KEY` | é opcional — sem ela, todo o resto funciona |

</details>

### 5. Sem interface, se preferir

```bash
.venv/bin/python -m src.cli
```

O mesmo agente, no terminal.

---

## As três ferramentas

Elas dividem o mesmo motor de consulta e servem a momentos diferentes. A barra
da esquerda alterna entre as três.

| | Para quê | O que guarda | Quando usar |
|---|---|---|---|
| 💬 **Chat** | uma pergunta, uma resposta | nada — é rascunho | explorar, testar uma hipótese |
| 🔖 **Temas** | acumular evidência sobre um assunto | blocos **congelados**, com SQL e fonte | montar um argumento que precisa ser conferível depois |
| 📊 **Painéis** | acompanhar números que mudam | consultas **vivas**, com filtros | olhar o mesmo recorte de várias formas |

No painel há três formas de criar: a **caixa em linguagem natural**, o **menu**
(medida, eixo, forma, cor — sem modelo no caminho) e a **análise completa**, em
que um assunto vira uma dúzia de mostradores de uma vez.

**A diferença entre tema e painel não é de gosto, é de garantia.** O bloco de um
tema fica congelado de propósito: um número citado num relatório precisa
continuar citável daqui a um mês. O widget de um painel precisa do contrário —
recalcular a cada filtro. Se um filtro pudesse mexer num bloco de tema, a
citação apodreceria.

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

### Temas: uma investigação que não se perde

<div align="center">
<img src="docs/img/09-tema.png" alt="Painel de um tema: mosaico de blocos com gráficos, indicadores e citações da web, com o chat do tema à direita" width="920">
</div>

Um tema é um espaço que acumula evidência sobre um assunto. Qualquer resposta do
chat pode ser **fixada** nele, e cada bloco guarda o resultado inteiro — o SQL, as
linhas, as suposições — para continuar legível daqui a um mês.

**Três coisas que o tema faz e o chat não:**

**1. As perguntas enxergam o que já foi apurado.** Perguntar *"e por sexo?"*
dentro de um tema herda o recorte dos blocos fixados, em vez de contar as 144
milhões de internações.

**2. O tema RESPONDE.** Se a resposta já está num bloco, ele lê o bloco em vez de
reconsultar o banco — e diz de onde tirou:

```
você › quantos óbitos por câncer já apuramos aqui?
       ⌾ respondido com o que já está fixado neste tema
       Foram 182.765 óbitos por neoplasia maligna (CID C00–C97) ¹
       ¹ Quantas pessoas morreram por algum tipo de câncer?
```

Clicar no número da citação rola até o card e o destaca. A regra do produto não
foi afrouxada, foi trocada por uma mais forte: de *"todo número veio da consulta
de agora"* para **"todo número veio de uma evidência identificada"**.

Perguntas *sobre* a investigação — "explique este tema", "o que já sabemos" —
recebem um panorama: do que se trata, o que foi estabelecido separando apuração
de citação, e o que fica em aberto.

**3. Busca em fontes confiáveis, com procedência.** Peça *"busque na internet
sobre X"* e os achados voltam com domínio, trecho literal e link, cada um com um
clique para virar citação no tema. A busca é restrita a domínios oficiais e
científicos (DATASUS, gov.br, IBGE, Fiocruz, SciELO, OMS, PubMed), e **o conteúdo
externo nunca entra no prompt que gera SQL** — uma página é conteúdo de terceiro,
e uma que diga "ignore as instruções anteriores" seria instrução chegando pelo
canal dos dados.

Os blocos se arrastam e se redimensionam livremente. Nada se reorganiza sozinho:
o bloco fica exatamente onde foi solto, e a grade de fundo mostra onde ele cabe.

### Painéis: números que se recalculam

<div align="center">
<img src="docs/img/07-painel.png" alt="Painel sobre óbitos por COVID-19: filtros de UF e faixa etária, três indicadores, série mensal e ranking por UF" width="920">
</div>

Um painel é o oposto de um tema: cada widget é uma **consulta viva**, sem
resultado guardado, que roda de novo a cada mudança de filtro.

**A mesma caixa cria gráfico, filtro e análise inteira.** O pedido é classificado
antes de agir:

```
"óbitos por ano"                      → widget
"quero ver só mulheres"               → filtro
"um gráfico de internações por sexo"  → widget
"filtro por faixa etária"             → filtro
"análise completa sobre óbitos de covid" → análise (vira uma dúzia dos acima)
```

As duas pistas de *análise* são pedir um **conjunto** e nomear um **assunto** em
vez de um recorte: "internações por UF" é widget, "análise das internações por
UF" é análise. Na dúvida ele escolhe widget — um gráfico a mais se apaga com um
clique, um filtro criado sem querer muda o painel inteiro, e uma análise dispara
uma dúzia de varreduras. Dois botões ao lado forçam a escolha quando ele erra.

**Os filtros são declarados, não fixos.** Peça *"um filtro por sexo, onde eu
possa escolher um ou os dois"* e o modelo declara a coluna, a forma do controle e
o fragmento SQL; o **código lê o domínio no banco**. Um controle de sexo escrito à
mão diria "Masculino/Feminino"; nesta base os valores são `1` e `3`, com a
contagem de cada um ao lado — e o modelo anota o que significam.

**O filtro alcança o SQL sem regerar nada.** O widget reserva um lugar no `WHERE`
na hora da criação, e o código injeta a conjunção dos filtros ativos. Trocar um
filtro é pura reexecução: determinística, sem modelo no caminho. Regerar o SQL a
cada movimento de slider custaria uma chamada por widget e — pior — não seria
determinístico: o gráfico mudaria por razão que não é o filtro.

### Montar sem escrever: o menu

<div align="center">
<img src="docs/img/11-menu.png" alt="Menu de criação aberto na aba Gráfico, com medida, agrupamento, série, forma, ordem e aparência" width="760">
</div>

A caixa em linguagem natural continua sendo o caminho rápido. O menu resolve o
que ela não resolve: quando a pessoa já sabe exatamente o que quer — *mortalidade
por faixa etária, separada por sexo, em barras 100%* — descrever isso em
português e torcer para a classificação acertar é mais trabalho que escolher em
quatro menus. E aqui **não há o que torcer**: sem modelo no caminho, o mesmo par
de escolhas produz sempre o mesmo gráfico.

| Aba | O que oferece |
|---|---|
| **Gráfico** | 10 medidas × 21 campos de eixo, série, forma, ordem, quantas categorias, título, cor, rótulos, legenda |
| **Filtro** | a coluna e o tipo de controle — faixa numérica, período (data a data), marcar vários, escolher um |
| **Análise completa** | um assunto vira um plano de mostradores (abaixo) |

**O catálogo é servido pelo backend, não escrito no cliente.** É o mesmo objeto
que monta o SQL lá; duplicar a lista aqui criaria duas verdades sobre quais
colunas existem, e a da tela é sempre a que erra por último. Ele carrega o que o
dicionário do banco documenta e ninguém acerta por adivinhação:

- **o molde do filtro**, que tem de se bastar — `i.MUNIC_RES IN (SELECT … WHERE SG_UF = ANY(?))` e não um `JOIN`, porque o fragmento é colado em widgets que talvez não tenham aquele join;
- **o rótulo legível**, que quase sempre mora em outra tabela: `SEXO` é 1 e 3 no fato, e quem lê o eixo quer *Masculino* e *Feminino*;
- **a sanidade** — `IDADE` registra até 130 e a faixa plausível vai a 120; `DT_SAIDA` tem nulo;
- **o que não se deve oferecer.** `GESTRISCO` está corrompida (TRUE em 99,6% das linhas, inclusive em 58,8 milhões de homens), `UTI_INT_TO` é zero em todas as linhas menos 29, `hospital` está vazia. **Um campo que não está no catálogo não aparece no menu** — é a forma mais barata de impedir um gráfico errado: não deixar que ele seja montável.

O menu **não manda SQL**: manda `{"measure":"obitos","field":"uf"}`. Se pudesse
mandar a consulta, seria um console de SQL com aparência de menu, e o validador
viraria enfeite.

Duas regras do dicionário viram código, não conselho: uma taxa carrega
`HAVING COUNT(*) >= 1000` (sem piso, o topo de um ranking de mortalidade é
sempre um grupo de três internações com 100%), e um campo de tempo ordena pela
categoria mesmo quando se pede "maior valor primeiro" — anos fora de ordem lado
a lado não são uma série temporal, e a linha entre eles não significa nada.

### Ajustar o gráfico: forma, eixos e cor

Cada widget tem o seu ajuste, **inclusive os que um modelo escreveu**. Trocar a
forma, escolher qual coluna vai para cada eixo, separar em séries, pintar cada
série, ligar rótulos e legenda.

O que faz isso valer é **não tocar no SQL**: o ajuste reetiqueta qual coluna do
resultado vai para onde. Nenhuma consulta roda de novo, nada varre 144 milhões
de linhas para trocar uma cor.

As colunas oferecidas saem do **resultado**, não de uma lista fixa. Um eixo que
aponta para coluna inexistente não dá erro — faz o gráfico desaparecer sem dizer
por quê. E o eixo Y é conferido para ser **numérico**:

```
O eixo Y é o do valor, e 'faixa_etaria' é categoria — o gráfico sairia em
branco. Para deitar as barras, mantenha os eixos e escolha a forma
'Barras horizontais'.
```

Essa mensagem existe porque eu produzi o estado que ela descreve: inverti os
eixos de um gráfico de mortalidade por faixa etária e as barras sumiram, sem uma
palavra. Um gráfico em branco parece "não há dado".

A cor escolhida à mão é a **exceção**, não o padrão. A paleta do tema é validada
para daltonismo e contraste; uma cor de seletor não passa por essa conferência,
então ela sobrepõe apenas onde foi escolhida — duas cores num gráfico de cinco
séries deixam as outras três na paleta.

### Análise completa: um assunto vira um painel

<div align="center">
<img src="docs/img/12-plano.png" alt="Plano de análise sobre partos: título, um parágrafo de ressalvas da base e doze itens marcáveis, cada um rotulado como indicador ou gráfico" width="700">
</div>

*"Crie uma análise completa sobre óbitos de covid"* não é um widget nem um
filtro. É uma dúzia deles, e **escolher quais é o trabalho**.

O planejador é a única chamada do projeto em esforço alto, e a razão é a
assimetria: ela custa uma chamada e decide o conteúdo de doze. Ele devolve
título, um parágrafo de raciocínio e a lista de itens — que a tela mostra antes
de disparar, para dar de desmarcar o que não interessa. Cada item vira uma tarefa
na fila, três de cada vez.

**O raciocínio fica na tela**, e é a única parte da análise que não vira widget:

> Não permite rastrear óbitos pós-alta nem identificar o hospital executante
> (tabela hospital vazia), tampouco calcular taxas por população; 2007 é parcial.

Sem isso, um painel de doze gráficos parece responder tudo.

**A regra que faz o resto funcionar** é que cada item é uma frase completa. Os
itens são executados depois, um por um, cada um numa chamada que não viu o plano,
não viu a pergunta original e não verá os outros itens:

```
RUIM   "óbitos por ano"          → num plano sobre COVID, produz os óbitos de TUDO:
                                   um número quinze vezes maior, com o título certo
BOM    "óbitos por COVID-19 por ano"
```

Também não vale escrever SQL no pedido: quem executa recebe o mesmo dicionário
do banco e escreve a consulta melhor. Ele precisa saber **o quê**, não **como**.

**O orçamento é imposto pelo código, não pedido ao modelo.** 2–4 indicadores,
4–6 gráficos, 1–3 filtros. Na primeira versão o modelo gastou as doze vagas em
seis indicadores e seis gráficos, sem nenhum filtro — um painel sem filtro não é
painel, é folha de gráficos, e "peça de novo" não é conserto. Um indicador
também é **um** número: pedir "total, óbitos, taxa e gasto" junto produz um
widget que mostra o primeiro e esconde os outros três.

### O relato: o que está acontecendo enquanto se espera

Montar um widget leva de dez a quarenta segundos; um plano de análise leva de um
a dois minutos. Antes, esse tempo era um cartão girando — e girar não distingue
*está escrevendo a consulta* de *travou*. Foi assim que uma chamada sem prazo
ficou nove minutos sem ninguém perceber.

Agora o servidor **transmite cada etapa** por SSE, e a tarefa vira um relato:

```
 ✓ Entendendo o pedido                        um gráfico
 ✓ Lendo o dicionário do banco                20 regras
 ● Escrevendo a consulta                                 17s   ▁▁▃▃▁▁
   Conferindo o SQL
   Executando sobre 144 milhões de linhas
   Guardando no painel
```

**Toda etapa é um fato.** Ela abre quando aquele trabalho começa e fecha quando
termina, com o que produziu ao lado — `20 regras`, `6 linha(s) em 0.5s`,
`2 opções · Feminino, Masculino`, `12 itens`. Nada avança por temporizador.

**Não há porcentagem, e a ausência é deliberada.** O passo caro é o modelo
escrever a consulta, e ninguém sabe de antemão quantos segundos ele vai levar.
Uma barra determinada chegaria ao fim antes dele e ficaria parada em 100% —
indistinguível de travada, que é exatamente o problema que isto resolve. O que
existe é uma varredura **indeterminada** e um cronômetro: os dois dizem *está
acontecendo, faz tanto tempo*, e nada além disso.

Numa análise, os itens do plano aparecem **um a um, conforme o modelo os
escreve**. O JSON é transmitido em pedaços e cada item é anunciado quando a sua
aspa de fechamento chega — meio pedido na tela seria pior que nenhum, porque
sumiria e voltaria diferente. O título chega aos 76s; os doze itens, entre 79s e
87s.

### A lupa: qual filtro vale em qual gráfico

<div align="center">
<img src="docs/img/08-lupa.png" alt="Lupa aberta num widget, listando os filtros do painel com caixas de marcação" width="920">
</div>

Por padrão um filtro novo vale para **todos** os gráficos. Mas nem todo recorte
faz sentido em todo lugar: num painel com "óbitos por sexo" ao lado de "total
geral", filtrar o primeiro por sexo o reduz a uma barra.

A lupa de cada widget mostra quais filtros valem ali e permite desligar um. Pela
linguagem também: *"adicione um filtro por caráter da internação, mas aplique só
no gráfico de óbitos"*.

O widget avisa no cabeçalho o que dispensou — e só para filtros que estão de fato
recortando. **Um filtro que silenciosamente vale para metade do painel é pior que
filtro nenhum:** a pessoa move o controle, vê três gráficos mudarem e dois não, e
conclui que os dois não mudaram por causa do dado.

### Aparência: cinco paletas, cromo e gráficos juntos

<div align="center">
<img src="docs/img/10-paletas.png" alt="Seletor de paletas mostrando Padrão, Argila, Daltonismo, Darcula e Alto contraste com amostras das cores reais" width="620">
</div>

| Paleta | |
|---|---|
| **Padrão** | azul-petróleo sobre neutros frios |
| **Argila** | creme e terracota, inspirada no Claude |
| **Daltonismo** | Okabe-Ito reordenado |
| **Darcula** | cinzas quentes do VS Code, com croma de dado |
| **Alto contraste** | preto e branco puros |

Cada paleta troca o fundo, as superfícies, o texto, o acento **e as cores das
séries dos gráficos**. Trocar só o cromo seria meia solução — uma paleta para
daltonismo que não alcança o gráfico não serve para nada, porque é no dado que a
cor carrega informação.

As séries não foram escolhidas por gosto: passaram pelo validador de paletas
(banda de luminosidade, piso de croma, separação sob deutan/protan, contraste com
a superfície). Dois achados que valem registro:

- **A ordem importa tanto quanto as cores.** O Okabe-Ito na ordem publicada dá
  ΔE 7,6 no pior par adjacente; reordenado, **18**. Mesmas cinco cores.
- **Cor de editor não é cor de dado.** As cores literais do Darcula *reprovam* —
  são pensadas para texto sobre fundo escuro, têm croma baixo, e `#6A8759` contra
  `#6897BB` dá ΔE 13,8, indistinguível até com visão normal.

Um tema pode ainda ter paleta própria, guardada no servidor: a aparência viaja no
link junto com a investigação.

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
  db.py                DuckDB read-only, validação, LIMIT, timeout, parâmetros
  value_linker.py      casa termos da pergunta com valores reais das dimensões
  schema_context.py    renderiza schema.yaml para o prompt
  roteador.py          no chat do tema: banco, web, tema ou os dois
  websearch.py         busca com lista branca de domínios (Tavily)
  storage.py           documentos JSON com escrita atômica
  cli.py               interface de linha de comando
  api.py               FastAPI + Server-Sent Events

  investigation/       o modo de várias consultas
    models.py          Etapa, Achado, Relatorio, Reflexao
    contracts.py       schemas de saída estruturada e prompts
    phases.py          planejar · executar · refletir
    runner.py          orquestra e é o único dono do orçamento

  themes/              TEMAS — evidência congelada, com procedência
    models.py          Tema, Bloco, Definicao; a grade em células
    contexto.py        o que o tema oferece à geração de SQL
    indice.py          catálogo dos blocos (sem dados) e detalhe (com)
    resposta.py        responder A PARTIR dos blocos, citando qual
    store.py           um arquivo JSON por tema

  paineis/             PAINÉIS — consultas vivas, com filtros
    models.py          Painel, Widget; o token {{FILTROS}}
    filtros.py         filtro declarado: fragmento, domínio, seleção
    catalogo.py        os campos e medidas do menu manual — sem modelo no caminho
    montar.py          escolhas de menu → SQL, pelo catálogo
    gerar.py           pergunta → widget com lugar reservado no WHERE
    gerar_filtro.py    pedido → filtro ancorado numa coluna real
    planejar.py        um assunto → o plano de mostradores que o respondem
    progresso.py       as etapas que o painel relata enquanto trabalha
    rotear.py          o pedido é gráfico, filtro ou análise inteira?
    executar.py        injeta a conjunção e roda; sem modelo no caminho

knowledge/schema.yaml  o dicionário curado — o artefato central

eval/
  ground_truth.yaml    272 casos com SQL gold
  run_eval.py          execution accuracy com tolerância
  testa_graficos.py    escolha da forma do gráfico, ponta a ponta
  testa_reflexao.py    reflexão isolada, com evidências sintéticas

frontend/src/
  components/          chat, resultado, gráfico, schema, relatório, paleta
  theme/               a tela de temas: grade, blocos, chat do tema
  dashboard/           a tela de painéis: filtros, widgets, lupa
  hooks/               useChat, useInvestigation, useTheme, usePaleta
  lib/                 cliente SSE, tipos, paletas, tema dos gráficos
  scripts/             testes sem navegador e captura dos screenshots
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
# agente
.venv/bin/python eval/testa_graficos.py         # 7/7 — forma do gráfico, ponta a ponta
.venv/bin/python eval/testa_reflexao.py         # 3/3 — reflexão, sem tocar o banco
.venv/bin/python eval/testa_painel_manual.py    # o catálogo do menu contra o banco real

# interface — rodam em segundos, sem navegador e sem banco
node --experimental-strip-types frontend/scripts/testa_grade.mjs
node --experimental-strip-types frontend/scripts/testa_paletas.mjs
```

`testa_painel_manual.py` é o que sustenta o menu manual. Como lá não há modelo
no caminho, também não há nenhuma etapa em que alguém leia o SQL antes de ele
rodar — a prova tem de vir de execução. Ele monta **todo campo com todo controle
que ele oferece**, confere que cada filtro de fato muda a contagem, e executa uma
amostra larga de gráficos; com `--tudo`, o produto cartesiano inteiro:

```
tudo passou · 210s     # 21 campos × 10 medidas, mais todo filtro e todo recorte
```

`testa_grade.mjs` cobre a geometria do painel: 800 arranjos aleatórios provando
que **nenhum vizinho se move** e que o alvo vai exatamente para onde foi pedido.
`testa_paletas.mjs` mede o contraste de texto das nove combinações paleta×modo —
ele foi quem descobriu que o tema **padrão** já reprovava, com `--ink-subtle` a
3,9:1 onde o comentário no CSS prometia 4,7:1.

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
- **Valor de filtro vai vinculado, nunca concatenado.** O painel usa parâmetros
  do DuckDB, então um valor vindo da tela não pode virar sintaxe. Conferido com
  `B342' OR '1'='1` e `x'; DROP TABLE internacoes; --` — os dois viraram texto e
  devolveram zero, com a tabela intacta.
- **Conteúdo da web nunca alcança a geração de SQL.** Ele chega ao redator da
  resposta cercado e rotulado como conteúdo de terceiro, com instrução de ignorar
  comandos que apareçam dentro. A lista branca de domínios reduz a superfície; a
  barreira a fecha.

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
- O painel **reexecuta todos os widgets** a cada mudança de filtro. O endpoint já
  aceita `?only=` para limitar aos visíveis, e a tela ainda não usa: com poucos
  widgets não incomoda, com vinte vai.
- O menu manual cobre **23 campos e 10 medidas** — os que o dicionário do banco
  documenta bem. Colunas fora dele (`INSTRU`, `VINCPREV`, `CBOR`, `ETNIA`) ficam
  só na linguagem natural: são quase vazias, e oferecê-las num menu convidaria a
  montar gráficos de "não informado".
- O planejador da análise leva **de um a dois minutos** antes de a fila começar:
  é uma chamada em esforço alto sobre o dicionário inteiro. A tela relata as
  etapas e mostra os itens do plano conforme são escritos, mas o tempo é esse.
- A grade é sempre de 12 colunas, sem quebra para tela estreita. Em desktop está
  certo; num celular fica apertado.

---

## Documentos

| | |
|---|---|
| [`docs/PROFILING.md`](docs/PROFILING.md) | o levantamento do banco que originou o dicionário |
| [`knowledge/schema.yaml`](knowledge/schema.yaml) | as 20 regras, cada uma com a evidência que a motivou |
| [`eval/ground_truth.yaml`](eval/ground_truth.yaml) | os 272 casos com SQL gold |
| [`docs/gera_arquitetura.py`](docs/gera_arquitetura.py) | gera o diagrama acima, nas versões clara e escura |
| [`src/paineis/filtros.py`](src/paineis/filtros.py) | por que um filtro inativo não entra na consulta |
| [`src/themes/resposta.py`](src/themes/resposta.py) | as três guardas de responder a partir de um bloco |

---

<div align="center">
<sub>

Os screenshots deste README são capturados contra a aplicação real por
[`screenshots.mjs`](frontend/scripts/screenshots.mjs) e
[`screenshots-painel.mjs`](frontend/scripts/screenshots-painel.mjs) — os scripts
sobem um Chromium, digitam as perguntas na interface e esperam o agente
responder. Nada é montado para a foto: os números nas imagens vieram do DuckDB.

</sub>
</div>
