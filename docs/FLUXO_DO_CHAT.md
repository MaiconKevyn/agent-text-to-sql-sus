# O caminho de uma pergunta, função por função

Este documento acompanha **uma pergunta do chat**, do momento em que alguém
aperta Enter até a última letra da resposta aparecer na tela — nomeando cada
função, o arquivo e a linha em que ela vive, o que recebe, o que devolve e por
que existe.

**Escopo.** Só o chat principal (`/api/ask`). Fora: temas, painéis, investigação
e a declaração de gráfico. Onde o caminho passa perto de um deles, há uma nota
dizendo o que foi omitido.

**Pergunta de exemplo**, usada o documento inteiro:

> *"Quantas internações por pneumonia houve em 2023?"*

---

## Mapa em uma tela

```
NAVEGADOR
  Composer.onKeyDown          Composer.tsx:94     Enter sem Shift
  → enviar()                  Composer.tsx:76
  → App.aoEnviar              App.tsx:74
  → useChat.send              useChat.ts:203      cria as duas mensagens
  → useChat.consumir          useChat.ts:76       abre o AbortController
  → api.ask                   api.ts:32           monta a URL
  → api.fluxo                 api.ts:48           lê o corpo em pedaços
                              ═══ HTTP ═══
SERVIDOR
  ask                         api.py:1296         a rota
  → fluxo                     api.py:1313         gerador que serializa
  → agente                    api.py:104          instância única
  → TextToSQLAgent.ask_stream agent.py:406        as 5 etapas
     1 interpretar            agent.py:436
     2 link_values            value_linker.py:110   ← BANCO
     3 generate_sql           agent.py:235          ← MODELO
     4 _execute_with_repair   agent.py:287          ← BANCO
     5 synthesize_streaming   agent.py:603          ← MODELO
                              ═══ HTTP ═══
NAVEGADOR
  switch (ev.type)            useChat.ts:95       11 casos
  → patch                     useChat.ts:47
  → React re-renderiza        MessageList / AgentMessage / StreamedText
  → salvarRodada              useChat.ts:61       depois do `done`
```

---

# PARTE I — Do teclado até o HTTP

## 1. `Composer` — a caixa de texto

**Arquivo:** `frontend/src/components/chat/Composer.tsx`

| Função | Linha | O que faz |
|---|---|---|
| `onKeyDown` | 94 | `Enter` sem `Shift` dá `preventDefault()` e chama `enviar()`. `Shift+Enter` cai no comportamento padrão do `textarea` e quebra a linha. |
| `enviar` | 76 | `if (!t \|\| busy) return` — a **primeira** das duas guardas contra reenvio. Chama `onSend(t)` (`:79`) e limpa a caixa. |

`onSend` é uma prop (`Composer.tsx:22`). O componente **não sabe** o que acontece
com a pergunta — não importa `useChat` nem a API.

## 2. `App` — a página

**Arquivo:** `frontend/src/App.tsx`

Na linha 30 o componente pega tudo do hook:

```ts
const { messages, busy, send, regenerate, setFeedback, stop, clear,
        abrir: abrirChat, chatAtual, versao } = useChat();
```

O handler passado ao `Composer` chama `send(q)` (`App.tsx:74`).

## 3. `useChat.send` — nasce o par de mensagens

**Arquivo:** `frontend/src/hooks/useChat.ts:203`

```ts
const send = useCallback((texto: string) => {
  const pergunta = texto.trim();
  if (!pergunta || busy) return;          // ← duas guardas
  const resposta = novaRespostaVazia(pergunta);
  setMessages((ms) => [...ms,
    { id: uid(), role: "user", text: pergunta, at: Date.now() },
    resposta,
  ]);
  void consumir(pergunta, resposta.id);
}, [busy, consumir]);
```

Três coisas acontecem aqui:

1. **`busy` bloqueia o reenvio** — de novo, já que o `Composer` também checa
   (`Composer.tsx:78`). A dupla guarda existe porque `send` é público: `App.tsx`
   o chama a partir dos chips de sugestão, que não passam pelo `Composer`.
2. **A resposta VAZIA é criada antes de qualquer rede.** É ela que segura as
   cinco etapas em `pendente` — a tela mostra o esqueleto do trabalho antes de o
   trabalho começar.
3. O id da resposta vira o alvo de todas as atualizações seguintes.

### `novaRespostaVazia` — `useChat.ts:22`

```ts
{ id, role: "agent", text: "", status: "pensando",
  steps: passosIniciais(), trace: [], at: Date.now(), sourceQuestion: pergunta }
```

`sourceQuestion` guarda a pergunta **na mensagem do agente**. É o que permite
`regenerate` (`useChat.ts:219`) refazer sem depender da mensagem anterior da
lista.

### `passosIniciais` — `useChat.ts:19`

```ts
ORDEM.map((id) => ({ id, label: STEP_LABELS[id], state: "pendente" }))
```

`ORDEM` (`:17`) é a lista canônica no cliente:
`interpretar · vincular · gerar-sql · executar · resumir`. Os rótulos vêm de
`STEP_LABELS` em `lib/types.ts:23`. **O servidor manda o id e o estado; o texto
está no cliente** — mudar "Gerando SQL" não exige tocar no backend.

## 4. `useChat.consumir` — o laço do stream

**Arquivo:** `useChat.ts:76`

```ts
const ctrl = new AbortController();
abort.current = ctrl;
setBusy(true);
const rodada: Partial<ChatTurn> = { question: pergunta };
```

`rodada` acumula **fora do estado do React** o que será salvo em disco. O
comentário nas linhas 84-87 registra o porquê:

> A primeira versão chamava `salvarRodada` DENTRO do atualizador passado a
> `setMessages`. Um atualizador tem de ser puro, e o StrictMode — que os invoca
> duas vezes justamente para expor impureza — gravou a mesma conversa duas
> vezes. Efeito colateral não mora em atualizador.

## 5. `api.ask` — monta a URL

**Arquivo:** `frontend/src/lib/api.ts:32`

```ts
const url = new URL("/api/ask", BASE);
url.searchParams.set("q", question);
if (history?.length) {
  url.searchParams.set("history",
    JSON.stringify(history.map((t) => ({ question: t.question, sql: t.sql }))));
}
yield* fluxo<StreamEvent>(url, signal);
```

O histórico vem de `historico.current` (`useChat.ts:52`), que guarda **as 3
últimas rodadas que tiveram SQL** — a constante é `HISTORICO = 3`
(`useChat.ts:15`).

Só rodada com SQL entra (`useChat.ts:165`): uma recusa não deixa nada para
reaproveitar num acompanhamento.

## 6. `api.fluxo` — lê o corpo em pedaços

**Arquivo:** `api.ts:48`

```ts
const resposta = await fetch(url, { signal, headers: { Accept: "text/event-stream" } });
const leitor = resposta.body.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
for (;;) {
  const { done, value } = await leitor.read();
  if (done) break;
  buffer += value;
  let corte: number;
  while ((corte = buffer.indexOf("\n\n")) !== -1) {   // blocos SSE
    const bloco = buffer.slice(0, corte);
    buffer = buffer.slice(corte + 2);
    const payload = bloco.split("\n").filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart()).join("\n");
    try { yield JSON.parse(payload) as T; } catch { /* bloco truncado: segue */ }
  }
}
```

**`fetch` e não `EventSource`**, e o comentário em `api.ts:28` dá as três razões:
`EventSource` não aceita `AbortSignal` (não daria para parar a geração), não
aceita cabeçalhos, e **reconecta sozinho ao terminar** — o que reiniciaria a
consulta inteira no banco.

O `buffer` existe porque um `read()` pode entregar meio bloco. O `try/catch`
engole JSON truncado em vez de derrubar o laço.

Falha de rede vira `BackendOffline` (`api.ts:18`), que `consumir` distingue de
erro comum para dar a mensagem com o comando do uvicorn (`useChat.ts:185`).

---

# PARTE II — O servidor

## 7. `ask` — a rota

**Arquivo:** `src/api.py:1296`

```python
@app.get("/api/ask")
def ask(q: str = Query(..., min_length=2, max_length=2000),
        history: str | None = Query(None)) -> StreamingResponse:
```

**GET** porque a versão original usava `EventSource`, que só faz GET. A
validação de tamanho é do FastAPI: pergunta com 1 caractere devolve 422 sem
chegar ao agente.

### Desserialização do histórico — `api.py:1302`

```python
turnos: list[Turn] = []
if history:
    try:
        turnos = [Turn(question=h["question"], sql=h.get("sql"))
                  for h in json.loads(history) if h.get("question")]
    except Exception:
        turnos = []   # histórico malformado não deve impedir a pergunta
```

Falhar aqui perderia a pergunta por causa de um campo auxiliar.

### `fluxo` — `api.py:1313`

```python
def fluxo() -> Iterator[str]:
    try:
        for evento in agente().ask_stream(q, turnos):
            yield sse(evento)
    except Exception as exc:
        yield sse({"type": "failure", "kind": "rede", "message": f"…{exc}"})
        yield sse({"type": "done"})
```

A rede de segurança final: **qualquer** exceção não prevista vira um evento
`failure` seguido de `done`, em vez de um stream que morre no meio. Um stream
cortado deixa a interface girando para sempre.

### `sse` — `api.py:144`

```python
def sse(evento: dict) -> str:
    return f"data: {json.dumps(evento, ensure_ascii=False)}\n\n"
```

`ensure_ascii=False` mantém os acentos legíveis no rastro.

### Cabeçalhos — `api.py:1330`

```
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no      ← sem isso um proxy entrega tudo de uma vez
```

## 8. `agente` — a instância única

**Arquivo:** `api.py:104`

```python
def agente() -> TextToSQLAgent:
    global _db, _agent
    if _agent is None:
        _db = Database()
        _agent = TextToSQLAgent(db=_db)
    return _agent
```

Abrir o DuckDB de 15,4 GB a cada requisição seria absurdo. A conexão vive
enquanto o processo viver.

### `TextToSQLAgent.__init__` — `agent.py:194`

```python
self.db = db or Database()
self._system = SQL_SYSTEM_PROMPT.format(
    schema=build_schema_prompt(), capabilities=capability_notes())
self._trace_seq = 0
```

**O prompt de sistema é montado UMA VEZ**, na criação. `build_schema_prompt` e
`capability_notes` têm `@functools.lru_cache(maxsize=1)`
(`schema_context.py:45` e `:87`), então o YAML é lido do disco uma vez por
processo.

### `build_schema_prompt` — `schema_context.py:46`

Percorre `knowledge/schema.yaml` e produz, nesta ordem:

| Seção | Fonte no YAML |
|---|---|
| `## BANCO DE DADOS` | engine, dialeto, granularidade, período |
| `## TABELAS` | cada tabela por `_render_table` (`:17`) — colunas com tipo e descrição, domínio, `⚠ caveat` |
| `## TABELAS PROIBIDAS` | `forbidden_tables` |
| `## JUNÇÕES CANÔNICAS` | `joins` |
| `## REGRAS CRÍTICAS` | `rules`, com `[SEVERIDADE] id` e o texto |
| `## EXEMPLOS RESOLVIDOS` | `examples`, pergunta + SQL |

É **este bloco** que impede `SEXO = 2` e `U07`. Não há RAG, embedding nem
recuperação: o dicionário inteiro vai no prompt, toda vez.

---

## 9. `ask_stream` — as cinco etapas

**Arquivo:** `agent.py:406`. Assinatura:

```python
def ask_stream(self, question: str, history: list[Turn] | None = None,
               contexto_tema: str = "") -> Iterator[dict]
```

> `contexto_tema` só é preenchido pelo chat do tema. No `/api/ask` ele é sempre
> `""`, e todo `if contexto_tema:` deste percurso é falso.

Duas fábricas locais, definidas em `:418` e `:421`:

```python
def passo(id_, estado, **extra):   # {"type":"step", "id":…, "state":…}
def rastro(etapa, titulo, corpo, fmt="text", **extra):  # {"type":"trace", "entry":{…}}
```

`rastro` incrementa `self._trace_seq` para dar id único a cada entrada.

---

### ETAPA 1 · Interpretar — `agent.py:436`

```python
t0 = time.perf_counter()
yield passo("interpretar", "ativo")
yield rastro("interpretar", "Pergunta recebida", question)
yield rastro("interpretar", "Instruções do sistema (schema + regras críticas)", self._system)
yield passo("interpretar", "concluido",
            elapsed=…, detail=f"{len(self._system):,} caracteres de contexto")
```

**Não toca o banco nem o modelo.** É contabilidade: publica o prompt de sistema
no rastro para o painel de depuração e fecha a etapa. Custa microssegundos.

**Eventos:** `step(ativo)` · `trace`×2 · `step(concluido)`

---

### ETAPA 2 · Value linking — `agent.py:454`

```python
yield passo("vincular", "ativo")
t1 = time.perf_counter()
hints = ""
try:
    hints = link_values(self.db, question)
except Exception:      # auxiliar: nunca derruba o fluxo
    pass
termos = _termos_da_pergunta(question)
```

O `except Exception: pass` é deliberado — value linking melhora a resposta, mas
sua falha não pode custar a pergunta.

#### `link_values` — `value_linker.py:110`

Ele existe para o modelo receber **códigos que existem** em vez de inventar. Faz
duas coisas:

**(a) CIDs escritos pelo usuário** — `_explicit_cids` (`:93`)

```python
re.findall(r"\b([A-Za-z]\d{2})\.?(\d?)\b", question)   # "J18.9" → "J189"
```

Se achou, consulta o banco:

```sql
SELECT CID, DESCRICAO, TP_NIVEL FROM cid WHERE CID IN (…) LIMIT 20
```

> **BANCO — `value_linker.py:118`**, com `add_limit=False` (o `LIMIT` já está no
> texto).

**(b) Termos clínicos** — `_terms` (`:73`)

```python
words = re.findall(r"[A-Za-zÀ-ÿ]+", question.lower())
base = strip_accents(w)
if base in _STOPWORDS or len(base) < _MIN_TERM_LEN: continue    # _MIN_TERM_LEN = 5
stem = base[:-2] if base.endswith(("as","es")) else base
stem = stem[:-1] if stem.endswith("s") else stem
```

Na pergunta de exemplo: `internações` cai por ser stopword (`:60`),
`pneumonia` → `pneumoni`, `2023` não casa o regex de letras.

`_word_prefix_match` (`:99`) monta a condição:

```python
f"regexp_matches(strip_accents(lower({column})), '\\b({pattern})')"
```

Casamento por **prefixo de palavra**, não palavra inteira — é o que faz
`pneumoni` alcançar `pneumonia` e `pneumonias`. `\b` é a fronteira do RE2, o
motor de regex do DuckDB.

Três consultas, no máximo 6 termos e 8 linhas por fonte:

| Fonte | Coluna |
|---|---|
| `cid` (só `TP_NIVEL='CAT'`) | `DESCRICAO` |
| `procedimentos` | `NOME_PROC` |
| `municipios` | `NO_MUNICIPIO` |

> **BANCO — `value_linker.py:147`**, cada uma dentro de `try/except: continue`.

O retorno (`:158`) é um bloco de texto que começa avisando:

> São SUGESTÕES, não instruções: use apenas os que correspondem de fato ao que o
> usuário perguntou e IGNORE o resto.

Sem esse aviso o modelo filtra por tudo que apareceu na lista.

**Eventos:** `step(ativo)` · `trace` · `step(concluido)` — ou `step(pulado)`
quando `hints` volta vazio (`agent.py:483`).

---

### ETAPA 3 · Gerar SQL — `agent.py:490`

```python
yield passo("gerar-sql", "ativo")
try:
    plan = self.generate_sql(question, hints, history, contexto_tema)
except Exception as exc:
    yield passo("gerar-sql", "falhou")
    yield {"type": "failure", "kind": "rede", "message": f"Falha ao falar com o modelo: {exc}"}
    return                                    # ← o gerador termina aqui
```

#### `generate_sql` — `agent.py:235`

Monta a mensagem do usuário por concatenação:

```python
user = f"Pergunta: {question}"
if hints:          user += f"\n\n{hints}"
if contexto_tema:  user += f"\n\n{contexto_tema}"      # sempre vazio no chat
bloco_historico = self._render_history(history or [])
user += bloco_historico
schema = SQL_SCHEMA_COM_HISTORICO if bloco_historico else SQL_SCHEMA
```

**A escolha do schema é a peça mais importante desta função.** Sem histórico o
contrato é *exatamente* o de antes de a memória existir — a avaliação chama
`ask(question)` sem `history`, então cada caso continua isolado e o campo
`continuidade` nem é pedido ao modelo. **A isolação é estrutural**, não uma
convenção que alguém precisa lembrar.

#### `_render_history` — `agent.py:203` (estático)

Só entra rodada que tem SQL (`:210`). Produz `## CONVERSA ATÉ AQUI` com as
últimas `HISTORY_TURNS = 3` (`agent.py:145`), e mais instrução do que dados:

- não decidir por gramática — *"em quais estados tiveram mais mortes?"* continua
  falando de covid mesmo tendo sujeito e verbo próprios;
- na dúvida **manter** os recortes: quem recebe um filtro a mais reconhece; quem
  perde um filtro recebe algo que parece certo e responde outra pergunta;
- preencher `continuidade` com o que foi feito, **inclusive o descartado**.

#### `complete` — `llm.py:57`

```python
kwargs = {"model": model, "messages": [{"role":"system","content":system}, *messages]}
if schema is not None:
    kwargs["response_format"] = {"type": "json_schema",
        "json_schema": {"name": schema_name, "strict": True, "schema": schema}}
if reasoning_effort and model.startswith(("gpt-5","o3","o4")):
    kwargs["reasoning_effort"] = reasoning_effort

resp = client().chat.completions.create(**kwargs)
content = resp.choices[0].message.content or ""
return json.loads(_repara_escapes(content)) if schema is not None else content
```

> **MODELO** — `settings.sql_model` (padrão `gpt-5-mini`),
> `reasoning_effort="medium"`. Saída estruturada com `strict: True`: o provedor
> garante a forma, não é parsing de texto.

#### `_repara_escapes` — `llm.py:30`

```python
_ESCAPE_QUEBRADO = re.compile(r"\\u0000([0-9a-fA-F]{2})")
```

O modelo às vezes escreve ` e7` onde queria `ç`. Aconteceu em 1 de 4
chamadas com texto acentuado. O estrago é silencioso: `json.loads` aceita, e
`"internações"` chega como `"interna\x00e7\x00f5es"` — num `WHERE 'São Paulo'`
isso vira uma cláusula que não casa com nada. É no-op para resposta bem formada.

#### O que `plan` traz — `SQL_SCHEMA`, `llm.py:158`

| Campo | Uso |
|---|---|
| `answerable` | `false` encerra o fluxo com recusa |
| `reasoning` | vai só para o rastro |
| `sql` | a consulta |
| `assumptions` | vira evento e entra no prompt da síntese |
| `refusal` | o texto da recusa |
| `chart` | *fora do escopo deste documento* |
| `continuidade` | só em `SQL_SCHEMA_COM_HISTORICO` |

#### Ramo A · Recusa — `agent.py:513`

```python
if not plan.get("answerable", True):
    yield passo("gerar-sql", "concluido", detail="a base não tem o dado pedido")
    yield passo("executar", "pulado")
    yield passo("resumir", "ativo")
    yield {"type": "refused"}
    texto = plan.get("refusal") or "Essa pergunta não pode ser respondida…"
    for pedaco in _fatiar(texto):
        yield {"type": "token", "text": pedaco}
    yield passo("resumir", "concluido")
    yield {"type": "done"}
    return
```

**O banco nunca é consultado.** `_fatiar` (`agent.py:712`) quebra o texto pronto
em pedaços de 2 palavras para a recusa também chegar fluindo — sem isso ela
apareceria de uma vez, com um ritmo diferente de toda outra resposta.

#### Ramo B · Segue — `agent.py:527`

```python
sql_gerado = _clean_sql(plan.get("sql", ""))
yield passo("gerar-sql", "concluido", detail=f"{len(sql_gerado.splitlines())} linhas de SQL")
yield {"type": "sql", "sql": sql_gerado}
if cont := _continuidade(plan):        yield {"type": "continuity", "continuity": cont}
if plan.get("assumptions"):            yield {"type": "assumptions", …}
```

`_clean_sql` (`agent.py:171`) remove cercas de markdown (` ```sql `) que o modelo
às vezes inclui apesar do schema.

`_continuidade` (`agent.py:626`) normaliza e **filtra a lista de descartados**
(`:641`): o modelo escreve `"nenhum — mantive tudo"` DENTRO de `descartado` em
vez de deixar a lista vazia, e sem o filtro o chip anuncia
*"Não manteve: nenhum — mantive tudo"*, que diz o contrário do que é.

---

### ETAPA 4 · Executar, com auto-reparo — `agent.py:540`

```python
yield passo("executar", "ativo")
res, sql_final, tentativas, erros = self._execute_with_repair(question, plan, hints)
```

#### `_execute_with_repair` — `agent.py:287`

```python
sql = _clean_sql(plan["sql"])
errors: list[str] = []
for attempt in range(1, settings.max_repair_attempts + 2):   # 1..3
    try:
        validate_sql(sql)
        self.db.explain(sql)
        res = self.db.run(sql)
        return res, sql, attempt, errors
    except Exception as exc:
        msg = f"{type(exc).__name__}: {exc}"
        errors.append(msg)
        if attempt > settings.max_repair_attempts:
            return None, sql, attempt, errors
        plan = self.repair_sql(question, sql, msg, hints)
        sql = _clean_sql(plan["sql"])
```

**A ordem das três chamadas é o ponto:**

##### `validate_sql` — `db.py:99`

Análise léxica, sem tocar o banco. `_strip_sql_noise` (`:90`) remove comentários
e literais de string primeiro, para a análise não se confundir com um `DROP`
dentro de uma aspa.

| Barra | Linha |
|---|---|
| SQL vazio ou só comentários | 101, 105 |
| `;` sobrando → mais de um comando | 109 |
| não começa com `SELECT`/`WITH` | 113 |
| token em `_WRITE_KEYWORDS` | 119 |
| `_staging_internacoes`, `hospital`, `socioeconomico` | 124 |

##### `Database.explain` — `db.py:234`

```python
sql = validate_sql(sql)
with self._lock:
    return self._con.execute(f"EXPLAIN {sql}").fetchall()[0][1]
```

**Pega coluna inexistente e erro de sintaxe em milissegundos**, sem varrer 144
milhões de linhas. É a diferença entre descobrir o erro antes ou depois de um
minuto de varredura.

> **BANCO — leitura de plano, sem execução.**

##### `Database.run` — `db.py:175`

```python
if validate:   sql = validate_sql(sql)
if add_limit:  sql, applied_limit = enforce_limit(sql)

start = time.perf_counter()
with self._lock:
    cur = self._con.cursor()
    timer = threading.Timer(settings.query_timeout_s, cur.interrupt)
    timer.start()
    try:
        cur.execute(sql, list(params)) if params else cur.execute(sql)
        columns = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchall()
    finally:
        timer.cancel(); cur.close()
```

| Peça | Por quê |
|---|---|
| `self._lock` (`:173`) | serializa; o DuckDB é um arquivo só e o processo atende várias requisições |
| cursor separado (`:204`) | permite `interrupt` sem derrubar a conexão |
| `Timer(120s, cur.interrupt)` (`:205`) | teto de tempo por consulta |
| `finally` (`:211`) | o timer é cancelado mesmo se a consulta explodir |

Chamado de `_execute_with_repair` **sem `max_rows`** — o comentário em
`agent.py:297` explica: o resultado completo fica disponível para a avaliação e
para a tabela; o corte para o modelo acontece depois, em `_format_rows`.

###### `enforce_limit` — `db.py:142`

```python
if re.search(r"\blimit\b\s+\d+", cleaned):        return sql, None   # já tem
if has_agg_fn and not has_group_by:               return sql, None   # escalar
applied = AGG_LIMIT if has_group_by else settings.default_limit      # 10.000 : 100
```

`COUNT(*)` sem `GROUP BY` devolve uma linha — `LIMIT` ali é irrelevante. O
`AGG_LIMIT = 10.000` (`:139`) existe só para conter um agrupamento acidental por
coluna de altíssima cardinalidade, como `N_AIH`.

###### `QueryResult` — `db.py:39`, montado em `:225`

```python
hit_limit = applied_limit is not None and len(rows) == applied_limit
QueryResult(columns=…, rows=…, elapsed_s=…, truncated=…, sql=sql,
            extra={"hit_injected_limit": hit_limit, "applied_limit": applied_limit})
```

`hit_injected_limit` volta para o chamador saber que **provavelmente há mais
linhas** — devolver 100 de 5.563 grupos sem avisar seria pior que devolver erro.

##### `repair_sql` — `agent.py:267`

Só roda se alguma das três levantou. Manda ao modelo a pergunta, o SQL que
falhou, **o erro do DuckDB** e os hints:

```
Corrija a query. Verifique nomes de coluna e tabela contra o schema acima
e reconfira as REGRAS CRÍTICAS.
```

> **MODELO** — mesmo `sql_model`, `reasoning_effort="medium"`, `SQL_SCHEMA` (sem
> histórico: reparo não é acompanhamento).

**O laço é SINTÁTICO.** Dispara quando o SQL levanta exceção — nunca quando o
número está errado. Um número errado que executa passa direto, e é para isso que
existe o `eval/`.

#### Falha definitiva — `agent.py:543`

```python
if res is None:
    yield passo("executar", "falhou")
    if erros: yield rastro("executar", "Erro do DuckDB", "\n\n".join(erros[-2:]))
    yield {"type": "failure", "kind": "sql", "message": f"…após {tentativas} tentativa(s)…"}
    return
```

Note: **não emite `done`.** O `finally` de `consumir` (`useChat.ts:193`) fecha o
`busy` de qualquer jeito, e sem `sql` a rodada não é salva.

#### Sucesso — `agent.py:557`

```python
if tentativas > 1:
    yield rastro("executar", f"Auto-correção: {tentativas-1} tentativa(s) antes de funcionar", …)
    yield {"type": "sql", "sql": sql_final}      # ← SQL de novo, o corrigido
yield rastro("executar", "SQL enviado ao DuckDB (com LIMIT de segurança)", res.sql, "sql")
yield passo("executar", "concluido", elapsed=…, detail=f"{len(res.rows)} linha(s) em …s")
yield {"type": "result", "result": {
    "columns": res.columns,
    "rows": linhas_json(res.rows[:500]),
    "nRows": len(res.rows),
    "elapsed": …,
    "truncated": len(res.rows) > 500 or bool(res.extra.get("hit_injected_limit")),
}}
```

**O evento `sql` pode chegar duas vezes.** O cliente sobrescreve
(`useChat.ts:110`), então a tela acaba mostrando a consulta que de fato rodou.

`linhas_json` (`db.py:68`) aplica `json_safe` (`:51`) célula a célula: `date` e
`datetime` viram ISO, `Decimal` vira `float`. Sem isso o `JSONResponse` estoura
com *"Object of type date is not JSON serializable"*.

---

### ETAPA 5 · Resumir — `agent.py:589`

```python
yield passo("resumir", "ativo")
yield rastro("resumir", "Instruções de redação da resposta", ANSWER_SYSTEM_PROMPT)
try:
    for pedaco in self.synthesize_streaming(question, res, plan.get("assumptions", [])):
        yield {"type": "token", "text": pedaco}
except Exception as exc:
    yield passo("resumir", "falhou")
    yield {"type": "failure", "kind": "rede", "message": f"Falha ao redigir: {exc}"}
    return
yield passo("resumir", "concluido", elapsed=…)
yield {"type": "done"}
```

#### `_payload_resposta` — `agent.py:313`

```python
payload = (f"Pergunta do usuário: {question}\n\n"
           f"Query executada:\n{res.sql}\n\n"
           f"Resultado ({len(res.rows)} linhas, {res.elapsed_s:.2f}s):\n"
           f"{_format_rows(res, settings.max_rows_to_llm)}")
if assumptions: payload += "\n\nSuposições feitas ao montar a query:\n…"
if res.extra.get("hit_injected_limit"):
    payload += ("\n\nATENÇÃO: o resultado bateu no limite de N linhas aplicado "
                "automaticamente — pode haver mais linhas. Diga isso ao usuário "
                "e não apresente o conjunto como completo.")
```

O aviso do limite é **texto no prompt**, não um campo estruturado: o modelo tem
de dizer isso na resposta, e a única forma de garantir é ele ler.

#### `_format_rows` — `agent.py:179`

```
coluna_a | coluna_b
-----------------
valor    | valor
... (+N linhas omitidas)
```

Corta em `settings.max_rows_to_llm` (**50**, `config.py:29`) e informa quantas
ficaram de fora. O modelo redige sobre 50 linhas, a tabela da tela mostra até
500, e a avaliação usa o conjunto inteiro.

#### `synthesize_streaming` — `agent.py:603` → `complete_streaming` — `llm.py:135`

```python
for chunk in client().chat.completions.create(**kwargs):
    if not chunk.choices: continue
    pedaco = chunk.choices[0].delta.content
    if pedaco: yield pedaco
```

> **MODELO** — `settings.answer_model`, `reasoning_effort="low"`. **Sem schema**:
> aqui a saída é prosa. A geração de SQL continua não-streaming porque JSON só
> serve completo.

O `if not chunk.choices` protege contra o pedaço final que vem só com métricas.

---

# PARTE III — De volta ao navegador

## 10. `switch (ev.type)` — `useChat.ts:95`

Cada evento é aplicado assim que chega. Antes de tudo, `useChat.ts:94`:

```ts
if (ctrl.signal.aborted) break;
```

| Evento | Linha | Efeito |
|---|---|---|
| `step` | 96 | atualiza um item de `steps` por id, preservando `elapsed`/`detail` anteriores |
| `trace` | 106 | anexa ao array `trace` |
| `sql` | 109 | grava em `rodada.sql` **e** no `payload` |
| `result` | 113 | idem |
| `continuity` | 117 | só no `payload` — não é salvo na rodada |
| `assumptions` | 127 | `rodada` **e** `payload` |
| `refused` | 134 | marca `payload.refused` |
| `token` | 137 | concatena em `rodada.text` e em `m.text`; muda `status` para `streaming` |
| `failure` | 151 | `status: "erro"`, guarda a falha e marca como `falhou` a etapa que estava `ativo` |
| `done` | 161 | fecha a mensagem e **atualiza o histórico** |

### `patch` — `useChat.ts:47`

```ts
setMessages((ms) => ms.map((m) => (m.id === id && m.role === "agent" ? fn(m) : m)));
```

Encontra por id **e** por papel. A dupla checagem evita que um id repetido
transforme uma mensagem do usuário em mensagem do agente.

### O caso `done` — `useChat.ts:161`

```ts
patch(respostaId, (m) => {
  if (m.payload?.sql) {
    historico.current = [...historico.current,
      { question: pergunta, sql: m.payload.sql }].slice(-HISTORICO);
  }
  return { ...m, status: "pronto" };
});
```

`slice(-3)` mantém a janela. Uma recusa não entra: não há SQL para reaproveitar.

## 11. `finally` — `useChat.ts:193`

```ts
setBusy(false);
abort.current = null;
if (!ctrl.signal.aborted && rodada.sql) void salvarRodada(rodada);
```

Roda **sempre**: sucesso, falha ou exceção. Três condições para salvar: não
abortado, tem SQL, e é uma gravação só por rodada.

## 12. `salvarRodada` — `useChat.ts:61`

```ts
try {
  if (!chatId.current) {
    const c = await createChat();          // POST /api/chats
    chatId.current = c.id; setChatAtual(c.id);
  }
  await appendTurn(chatId.current, rodada); // POST /api/chats/{id}/turns
  setVersao((v) => v + 1);
} catch { /* silencioso de propósito */ }
```

**A conversa é criada na primeira rodada bem-sucedida**, não ao abrir a tela —
senão cada visita deixaria uma conversa vazia. E o `catch` vazio é deliberado
(`:71`): *"Não salvar é ruim; derrubar a resposta que o usuário acabou de
receber é pior."*

### `acrescentar_rodada` — `api.py:333` → `Conversas.acrescentar` — `chats/store.py:39`

```python
chat = self.ler(id_)
chat.acrescenta(rodada)
return self._docs.salvar(chat)
```

#### `Chat.acrescenta` — `chats/models.py:80`

```python
self.rodadas.append(rodada)
if not self.titulo and rodada.pergunta:
    t = " ".join(rodada.pergunta.split())
    self.titulo = t[:MAX_TITULO-1] + "…" if len(t) > MAX_TITULO else t
self.toca()
```

O título sai da **primeira pergunta**, e sai daqui — não de uma chamada ao
modelo. *"Conversa de 25/07 23:41"* não é encontrável seis dias depois;
*"Quantas mortes por covid?"* é.

#### `Documentos.salvar` — `storage.py:82`

```python
fd, temporario = tempfile.mkstemp(dir=self.raiz, suffix=".tmp")
with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(dados)
os.replace(temporario, caminho)          # atômico
```

Escrita atômica: uma interrupção no meio deixaria o arquivo truncado e a
conversa perdida.

## 13. A tela

| Componente | Arquivo | Papel |
|---|---|---|
| `MessageList` | `components/chat/MessageList.tsx` | percorre `messages`; `useAutoScroll` mantém no fim |
| `UserMessage` | `UserMessage.tsx` | 14 linhas |
| `AgentMessage` | `AgentMessage.tsx` | orquestra etapas, SQL, tabela, texto, ações |
| `ThinkingSteps` | `ThinkingSteps.tsx` | as 5 etapas com estado e tempo |
| `StreamedText` | `StreamedText.tsx` | o texto, com cursor durante `streaming` |
| `ContinuityChip` | `ContinuityChip.tsx` | o que herdou / o que descartou |
| `SqlBlock`, `ResultTable` | `components/result/` | **compartilhados** com tema e painel |

O React re-renderiza a cada `patch`. Como `token` chega dezenas de vezes por
segundo, o texto cresce na tela na cadência em que o modelo o escreve.

---

# Resumo dos custos

| Etapa | Modelo | Banco | Tempo típico |
|---|---|---|---|
| 1 · Interpretar | — | — | µs |
| 2 · Value linking | — | **1 a 4 consultas** em dimensões | 0,1–1 s |
| 3 · Gerar SQL | **1 chamada** (`medium`) | — | 5–30 s |
| 4 · Executar | 0 a 2 (só se falhar) | **EXPLAIN + run** | 0,3–10 s |
| 5 · Resumir | **1 chamada** (`low`, streaming) | — | 3–15 s |

**Duas chamadas ao modelo e duas ao banco** no caminho feliz. Uma recusa custa
uma chamada e nenhuma consulta.

# Onde tocar, e o que respinga

| Mudança | Arquivo | Alcance |
|---|---|---|
| rótulo/ordem das etapas na tela | `lib/types.ts:23`, `useChat.ts:17` | só o chat |
| texto do erro de conexão | `useChat.ts:185` | só o chat |
| janela do histórico | `useChat.ts:15` (cliente) + `agent.py:145` (servidor) | chat e tema |
| prompt de geração de SQL | `agent.py` `SQL_SYSTEM_PROMPT` | **os 4 usos + 272 casos do eval** |
| esquema de saída | `llm.py:158` | **idem** |
| regras do banco | `knowledge/schema.yaml` | **idem** |
| limite, timeout, validação | `db.py` | **tudo** |
| linkagem de valores | `value_linker.py` | chat e tema |

Antes e depois de mexer em qualquer linha da terceira seção:

```bash
.venv/bin/python eval/run_eval.py
```
