/**
 * Cliente do agente. Consome o SSE de `GET /api/ask` e devolve os eventos como
 * um `AsyncGenerator`, que é o que a UI já esperava do mock antigo.
 *
 * Não há tradução de formato: o backend emite exatamente `StreamEvent`, então
 * o contrato vive em `lib/types.ts` e vale dos dois lados.
 */
import type { DatabaseSchema, StreamEvent, Turn, InvestigationEvent, Concept, ConceptCandidate, Theme, ThemeBlock, ThemeDefinition, SavedChat, ChatTurn, SearchResult } from "./types";

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
          yield JSON.parse(payload) as StreamEvent;
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

/**
 * Nova ordem dos blocos no painel.
 *
 * Manda a lista inteira de ids, não "moveu de 3 para 1": o servidor ordena pelo
 * que recebe e o que não vier na lista fica no fim, então uma chamada perdida
 * no meio de um arrasto não deixa o painel num estado que ninguém pediu.
 */
export const reorderBlocks = (id: string, order: string[]) =>
  json<Theme>(`/api/themes/${id}/reorder`, {
    method: "POST",
    body: JSON.stringify({ order }),
  });

/** Formato e tamanho do bloco no painel. */
export const layoutBlock = (
  id: string,
  blocoId: string,
  layout: { format?: string; size?: string },
) =>
  json<Theme>(`/api/themes/${id}/blocks/${blocoId}/layout`, {
    method: "POST",
    body: JSON.stringify(layout),
  });
