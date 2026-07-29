/**
 * Cliente do agente. Consome o SSE de `GET /api/ask` e devolve os eventos como
 * um `AsyncGenerator`, que é o que a UI já esperava do mock antigo.
 *
 * Não há tradução de formato: o backend emite exatamente `StreamEvent`, então
 * o contrato vive em `lib/types.ts` e vale dos dois lados.
 */
import type { AnalysisPlan, ChartSpec, Dashboard, PanelCatalog, PanelStep, PlanItem, WidgetData, WidgetDisplay, WidgetDraft, DatabaseSchema, StreamEvent, Turn, InvestigationEvent, Concept, ConceptCandidate, Theme, ThemeBlock, ThemeDefinition, SavedChat, ChatTurn, SearchResult } from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface AskOptions {
  signal?: AbortSignal;
  history?: Turn[];
}

/** Erro que a UI reconhece como "backend fora do ar". */
export class BackendOffline extends Error {
  constructor(public readonly causa: string) {
    super(causa);
    this.name = "BackendOffline";
  }
}

/**
 * Lê o corpo da resposta e emite um evento por bloco `data:`.
 *
 * Usa `fetch` em vez de `EventSource` por dois motivos: `EventSource` não
 * aceita `AbortSignal` (não dá para parar a geração) nem cabeçalhos, e reconecta
 * sozinho ao terminar — o que reiniciaria a consulta inteira no banco.
 */
export async function* ask(
  question: string,
  { signal, history }: AskOptions = {},
): AsyncGenerator<StreamEvent> {
  const url = new URL("/api/ask", BASE);
  url.searchParams.set("q", question);
  if (history?.length) {
    url.searchParams.set(
      "history",
      JSON.stringify(history.map((t) => ({ question: t.question, sql: t.sql }))),
    );
  }
  yield* fluxo<StreamEvent>(url, signal);
}

/** A leitura de um fluxo SSE: um evento por bloco `data:`. */
export async function* fluxo<T>(url: URL, signal?: AbortSignal): AsyncGenerator<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { signal, headers: { Accept: "text/event-stream" } });
  } catch (e) {
    if (signal?.aborted) return;
    throw new BackendOffline(
      e instanceof Error ? e.message : "não foi possível conectar",
    );
  }

  if (!resposta.ok || !resposta.body) {
    throw new BackendOffline(`o servidor respondeu ${resposta.status}`);
  }

  const leitor = resposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      buffer += value;

      // Blocos SSE são separados por linha em branco.
      let corte: number;
      while ((corte = buffer.indexOf("\n\n")) !== -1) {
        const bloco = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        const payload = bloco
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!payload) continue;
        try {
          yield JSON.parse(payload) as T;
        } catch {
          // Bloco truncado ou comentário do servidor: ignora e segue.
        }
      }
    }
  } finally {
    await leitor.cancel().catch(() => {});
  }
}

export interface Health {
  ok: boolean;
  internacoes?: number;
  model?: string;
  database?: string;
  error?: string;
}

export async function health(signal?: AbortSignal): Promise<Health> {
  try {
    const r = await fetch(new URL("/api/health", BASE), { signal });
    return (await r.json()) as Health;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sem conexão" };
  }
}

export async function fetchSchema(signal?: AbortSignal): Promise<DatabaseSchema> {
  const r = await fetch(new URL("/api/schema", BASE), { signal });
  if (!r.ok) throw new BackendOffline(`o servidor respondeu ${r.status}`);
  return (await r.json()) as DatabaseSchema;
}

/** Perguntas de exemplo da tela inicial. */
export const SUGGESTED_QUESTIONS = [
  {
    text: "Quais os 10 municípios com mais internações por pneumonia em 2023?",
    hint: "ranking geográfico",
  },
  {
    text: "Como evoluiu o custo médio de internação no RS nos últimos 5 anos?",
    hint: "série temporal",
  },
  {
    text: "Qual a taxa de mortalidade hospitalar por faixa etária?",
    hint: "indicador por grupo",
  },
  {
    text: "Quantas pessoas morreram por algum tipo de câncer?",
    hint: "mapeia conceito clínico para CID",
  },
  {
    text: "Qual o nome do hospital que mais internou pacientes em 2022?",
    hint: "a base não responde",
  },
  {
    text: "Qual a previsão de internações para 2026?",
    hint: "fora do alcance",
  },
];

/**
 * Investigação: várias consultas para uma pergunta só. Leva minutos, então os
 * eventos de fase existem para a interface não ficar muda enquanto roda.
 */
export async function* investigate(
  question: string,
  { signal }: { signal?: AbortSignal } = {},
): AsyncGenerator<InvestigationEvent> {
  const url = `${BASE}/api/investigate?q=${encodeURIComponent(question)}`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal, headers: { Accept: "text/event-stream" } });
  } catch (causa) {
    throw new BackendOffline(String(causa));
  }
  if (!resp.ok || !resp.body) {
    throw new Error(`A investigação falhou (HTTP ${resp.status}).`);
  }

  const leitor = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    resto += value;
    const partes = resto.split("\n\n");
    resto = partes.pop() ?? "";
    for (const parte of partes) {
      const linha = parte.split("\n").find((l) => l.startsWith("data:"));
      if (!linha) continue;
      yield JSON.parse(linha.slice(5).trim()) as InvestigationEvent;
    }
  }
}

/** Resolve um termo clínico nos códigos que ele significa nesta base. */
export async function resolveConcept(term: string, signal?: AbortSignal): Promise<Concept> {
  const r = await fetch(`${BASE}/api/concept?term=${encodeURIComponent(term)}`, { signal });
  if (!r.ok) throw new Error(`Não foi possível resolver "${term}" (HTTP ${r.status}).`);
  return (await r.json()) as Concept;
}

/**
 * Reconta no banco quando a seleção muda.
 *
 * Somar os candidatos marcados no cliente seria mais rápido e estaria errado:
 * uma internação de parto tem procedimento E diagnóstico de parto, e a soma a
 * conta duas vezes — 43,5 milhões onde a união é 25,0 milhões.
 */
export async function countConcept(
  selecao: ConceptCandidate[],
  signal?: AbortSignal,
): Promise<number> {
  const r = await fetch(`${BASE}/api/concept/count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selecao.map((c) => ({ code: c.code, column: c.column }))),
    signal,
  });
  if (!r.ok) throw new Error(`Falha ao contar (HTTP ${r.status}).`);
  return ((await r.json()) as { total: number }).total;
}

/* --------------------------------------------------------------------------
   Temas de investigação.
   -------------------------------------------------------------------------- */

async function json<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  }).catch((causa) => {
    throw new BackendOffline(String(causa));
  });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${caminho} falhou (HTTP ${r.status}).`);
  return (await r.json()) as T;
}

export const listThemes = () => json<Theme[]>("/api/themes");
export const readTheme = (id: string) => json<Theme>(`/api/themes/${id}`);

export const createTheme = (title: string, description = "") =>
  json<Theme>("/api/themes", { method: "POST", body: JSON.stringify({ title, description }) });

export const renameTheme = (id: string, title: string, description?: string) =>
  json<Theme>(`/api/themes/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ title, description }),
  });

export const deleteTheme = (id: string) => json<{ ok: true }>(`/api/themes/${id}`, { method: "DELETE" });

/** Fixa um bloco. O bloco viaja inteiro — resultado, gráfico e definição. */
export const pinBlock = (id: string, bloco: Partial<ThemeBlock>) =>
  json<Theme>(`/api/themes/${id}/blocks`, { method: "POST", body: JSON.stringify(bloco) });

export const unpinBlock = (id: string, blocoId: string) =>
  json<Theme>(`/api/themes/${id}/blocks/${blocoId}`, { method: "DELETE" });

export const noteBlock = (id: string, blocoId: string, note: string) =>
  json<Theme>(`/api/themes/${id}/blocks/${blocoId}/note`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });

export const defineInTheme = (id: string, d: Partial<ThemeDefinition>) =>
  json<Theme>(`/api/themes/${id}/definitions`, { method: "POST", body: JSON.stringify(d) });


/**
 * Pergunta feita DENTRO de um tema.
 *
 * Mesmo formato de evento do `ask`, então a interface do chat não muda — o que
 * muda é o servidor, que injeta os blocos já fixados e as definições do tema na
 * geração de SQL. É o que faz "e como isso se divide por sexo?" herdar o
 * recorte de covid em vez de contar todas as internações.
 */
export async function* askInTheme(
  temaId: string,
  question: string,
  { signal, history = [] }: { signal?: AbortSignal; history?: Turn[] } = {},
): AsyncGenerator<StreamEvent> {
  const p = new URLSearchParams({ q: question });
  if (history.length) p.set("history", JSON.stringify(history));
  let resp: Response;
  try {
    resp = await fetch(`${BASE}/api/themes/${temaId}/ask?${p}`, {
      signal,
      headers: { Accept: "text/event-stream" },
    });
  } catch (causa) {
    throw new BackendOffline(String(causa));
  }
  if (!resp.ok || !resp.body) throw new Error(`A pergunta falhou (HTTP ${resp.status}).`);

  const leitor = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    resto += value;
    const partes = resto.split("\n\n");
    resto = partes.pop() ?? "";
    for (const parte of partes) {
      const linha = parte.split("\n").find((l) => l.startsWith("data:"));
      if (linha) yield JSON.parse(linha.slice(5).trim()) as StreamEvent;
    }
  }
}

/* --- conversas salvas ----------------------------------------------------- */

export const listChats = () => json<SavedChat[]>("/api/chats");
export const readChat = (id: string) => json<SavedChat>(`/api/chats/${id}`);
export const createChat = () => json<SavedChat>("/api/chats", { method: "POST" });
export const deleteChat = (id: string) =>
  json<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" });

/** Salva uma rodada assim que ela termina — quem fecha a aba não avisa antes. */
export const appendTurn = (id: string, turn: Partial<ChatTurn>) =>
  json<SavedChat>(`/api/chats/${id}/turns`, { method: "POST", body: JSON.stringify(turn) });

/* --- busca em fontes confiáveis ------------------------------------------- */

export const searchStatus = () =>
  json<{ available: boolean; domains: string[] }>("/api/search/status");

/** Devolve candidatos para escolha humana. Nada aqui é fixado sozinho. */
export const searchWeb = (q: string) =>
  json<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`);

/** Paleta própria do tema. String vazia devolve à paleta do site. */
export const setPalette = (id: string, palette: string) =>
  json<Theme>(`/api/themes/${id}/palette`, {
    method: "POST",
    body: JSON.stringify({ palette }),
  });

export const setGrid = (
  id: string,
  layout: { id: string; x: number; y: number; width: number; height: number }[],
) =>
  json<Theme>(`/api/themes/${id}/grid`, {
    method: "POST",
    body: JSON.stringify({ layout }),
  });

/** Só o formato de apresentação do bloco. */
export const layoutBlock = (
  id: string,
  blocoId: string,
  layout: { format?: string; width?: number; height?: number },
) =>
  json<Theme>(`/api/themes/${id}/blocks/${blocoId}/layout`, {
    method: "POST",
    body: JSON.stringify(layout),
  });

/* --------------------------------------------------------------------------
   Painéis.
   -------------------------------------------------------------------------- */

export const listDashboards = () => json<Dashboard[]>("/api/dashboards");
export const readDashboard = (id: string) => json<Dashboard>(`/api/dashboards/${id}`);

export const createDashboard = (title = "") =>
  json<Dashboard>("/api/dashboards", { method: "POST", body: JSON.stringify({ title }) });

export const deleteDashboard = (id: string) =>
  json<{ ok: boolean }>(`/api/dashboards/${id}`, { method: "DELETE" });

/**
 * Monta um widget a partir de uma pergunta. `refused` preenchido é resposta
 * legítima, não erro: a base pode não ter o dado, ou a consulta pode não passar
 * nas conferências. Melhor recusar na criação que entregar um widget que só
 * quebra quando alguém mexe no filtro.
 */
export const createWidget = (id: string, question: string) =>
  json<{ refused: string; dashboard?: Dashboard; widgetId?: string }>(
    `/api/dashboards/${id}/widgets`,
    { method: "POST", body: JSON.stringify({ question }) },
  );

export const deleteWidget = (id: string, widgetId: string) =>
  json<Dashboard>(`/api/dashboards/${id}/widgets/${widgetId}`, { method: "DELETE" });

/**
 * A caixa do painel: um pedido vira widget ou filtro, conforme a intenção.
 * `refused` preenchido é resposta legítima — a base pode não ter o recorte.
 */
export const askDashboard = (id: string, request: string) =>
  json<{
    kind: "widget" | "filtro" | "analise";
    refused: string;
    reason: string;
    dashboard?: Dashboard;
    createdId?: string;
    /* Em "analise" o servidor não cria nada: devolve o plano, e quem enfileira
       os itens é a tela — assim cada um vira uma tarefa com o seu próprio
       sucesso ou recusa, em vez de uma chamada de três minutos que ou traz doze
       widgets ou não traz nenhum. */
    title?: string;
    reasoning?: string;
    items?: PlanItem[];
  }>(`/api/dashboards/${id}/ask`, { method: "POST", body: JSON.stringify({ request }) });

/** Pede o plano direto, sem passar pelo roteador: o botão já diz a intenção. */
export const planDashboard = (id: string, request: string) =>
  json<AnalysisPlan>(`/api/dashboards/${id}/plan`, {
    method: "POST",
    body: JSON.stringify({ request }),
  });

/* --------------------------------------------------------------------------
   As versões que RELATAM enquanto trabalham.

   Montar um widget leva de dez a quarenta segundos e um plano leva dois
   minutos. As versões POST acima continuam existindo porque são o caminho de
   quem só quer o resultado — testes, scripts —, mas a tela usa estas: um
   cartão girando não distingue "está escrevendo a consulta" de "travou".
   -------------------------------------------------------------------------- */

type EventoDoPainel =
  | ({ type: "step" } & PanelStep)
  | ({ type: "done" } & Record<string, unknown>);

async function comRelato<T>(
  caminho: string,
  request: string,
  aoPassar: (p: PanelStep) => void,
): Promise<T> {
  const url = new URL(caminho, BASE);
  url.searchParams.set("request", request);
  let ultimo: T | null = null;
  for await (const e of fluxo<EventoDoPainel>(url)) {
    if (e.type === "step") aoPassar(e);
    else ultimo = e as T;
  }
  // Sem o evento final o trabalho não terminou — a conexão caiu no meio, e
  // tratar isso como sucesso mudo deixaria a tarefa "pronta" sem nada na tela.
  if (!ultimo) throw new Error("A conexão caiu antes de o trabalho terminar.");
  return ultimo;
}

export const askDashboardStream = (
  id: string,
  request: string,
  aoPassar: (p: PanelStep) => void,
) =>
  comRelato<{
    kind: "widget" | "filtro" | "analise";
    refused: string;
    reason: string;
    createdId?: string;
    title?: string;
    reasoning?: string;
    items?: PlanItem[];
  }>(`/api/dashboards/${id}/ask/stream`, request, aoPassar);

export const planDashboardStream = (
  id: string,
  request: string,
  aoPassar: (p: PanelStep) => void,
) => comRelato<AnalysisPlan>(`/api/dashboards/${id}/plan/stream`, request, aoPassar);

export const renameDashboard = (id: string, title: string) =>
  json<Dashboard>(`/api/dashboards/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });

/* --------------------------------------------------------------------------
   Menu manual: o catálogo, e os dois construtores que bebem dele.
   -------------------------------------------------------------------------- */

/** Constante do servidor — nada de banco no caminho. Vale guardar em memória. */
export const panelCatalog = () => json<PanelCatalog>("/api/dashboards/catalog");

export const createFilterManual = (id: string, field: string, kind: string, label = "") =>
  json<{ refused: string; dashboard?: Dashboard; filterId?: string }>(
    `/api/dashboards/${id}/filters/manual`,
    { method: "POST", body: JSON.stringify({ field, kind, label }) },
  );

/**
 * Refaz um widget a partir de novas escolhas, NO MESMO LUGAR.
 *
 * Não é apagar e criar: o widget novo nasceria no fim da grade e o painel se
 * reorganizaria porque alguém trocou "internações" por "óbitos". O id, a
 * posição e as exclusões da lupa sobrevivem.
 */
export const updateWidgetManual = (id: string, widgetId: string, draft: WidgetDraft) =>
  json<{ refused: string; dashboard?: Dashboard }>(
    `/api/dashboards/${id}/widgets/${widgetId}/manual`,
    { method: "PUT", body: JSON.stringify(draft) },
  );

/** Compacto e tamanho do número. Não toca em SQL nem em gráfico. */
export const updateWidgetDisplay = (id: string, widgetId: string, display: WidgetDisplay) =>
  json<{ refused: string; dashboard?: Dashboard }>(
    `/api/dashboards/${id}/widgets/${widgetId}/display`,
    { method: "PATCH", body: JSON.stringify(display) },
  );

/**
 * Troca coluna, controle ou nome de um filtro existente. O id sobrevive porque
 * as exclusões por widget o referenciam.
 */
export const updateFilter = (
  id: string,
  filterId: string,
  patch: { field?: string; kind?: string; label?: string },
) =>
  json<{ refused: string; dashboard?: Dashboard }>(`/api/dashboards/${id}/filters/${filterId}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const createWidgetManual = (id: string, draft: WidgetDraft) =>
  json<{ refused: string; dashboard?: Dashboard; widgetId?: string }>(
    `/api/dashboards/${id}/widgets/manual`,
    { method: "POST", body: JSON.stringify(draft) },
  );

/**
 * Troca forma, eixos e cores de um widget que já existe.
 *
 * Só a aparência — o SQL não é tocado. É o que faz o ajuste valer também para
 * os widgets que um modelo escreveu, que são a maioria.
 */
export const updateWidgetChart = (
  id: string,
  widgetId: string,
  patch: Partial<ChartSpec> & { appearance?: Partial<ChartSpec> },
) =>
  json<{ refused: string; dashboard?: Dashboard }>(
    `/api/dashboards/${id}/widgets/${widgetId}/chart`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );

export const createFilter = (id: string, request: string) =>
  json<{ refused: string; dashboard?: Dashboard; filterId?: string }>(
    `/api/dashboards/${id}/filters`,
    { method: "POST", body: JSON.stringify({ request }) },
  );

/** Liga ou desliga um filtro naquele widget — o que a lupa controla. */
export const toggleWidgetFilter = (id: string, widgetId: string, filterId: string) =>
  json<Dashboard>(`/api/dashboards/${id}/widgets/${widgetId}/filters/${filterId}`, {
    method: "POST",
  });

export const deleteFilter = (id: string, filterId: string) =>
  json<Dashboard>(`/api/dashboards/${id}/filters/${filterId}`, { method: "DELETE" });

export const selectFilter = (id: string, filterId: string, selection: (string | number)[]) =>
  json<Dashboard>(`/api/dashboards/${id}/filters/${filterId}/selection`, {
    method: "POST",
    body: JSON.stringify({ selection }),
  });

export const setDashboardGrid = (
  id: string,
  layout: { id: string; x: number; y: number; width: number; height: number }[],
) =>
  json<Dashboard>(`/api/dashboards/${id}/grid`, {
    method: "POST",
    body: JSON.stringify({ layout }),
  });

/** Roda os widgets sob os filtros atuais. Sem modelo no caminho. */
export const dashboardData = (id: string, only?: string[]) =>
  json<{ data: WidgetData[] }>(
    `/api/dashboards/${id}/data${only?.length ? `?only=${only.join(",")}` : ""}`,
  );
