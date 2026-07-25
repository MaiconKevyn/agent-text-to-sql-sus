/**
 * Cliente do agente. Consome o SSE de `GET /api/ask` e devolve os eventos como
 * um `AsyncGenerator`, que é o que a UI já esperava do mock antigo.
 *
 * Não há tradução de formato: o backend emite exatamente `StreamEvent`, então
 * o contrato vive em `lib/types.ts` e vale dos dois lados.
 */
import type { DatabaseSchema, StreamEvent, Turn } from "./types";

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
