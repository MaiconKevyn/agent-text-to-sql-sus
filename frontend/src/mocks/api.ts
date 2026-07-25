/**
 * API mockada do agente text-to-SQL.
 *
 * Emite os mesmos eventos que o backend real emitiria, na mesma ordem e com
 * durações medidas de execuções reais (`traces.json` foi gerado rodando o
 * agente Python contra o DuckDB de 144 milhões de linhas). Trocar este módulo
 * por um cliente HTTP/SSE não deve exigir mudança na UI.
 */
import rawTraces from "./traces.json";
import type {
  FailureKind,
  QueryResult,
  StepId,
  StreamEvent,
  TraceEntry,
} from "@/lib/types";

interface RawTrace {
  question: string;
  termos: string[];
  valueHints: string;
  durations: Record<string, number>;
  plan: {
    answerable: boolean;
    reasoning: string;
    sql: string;
    assumptions: string[];
    refusal: string;
  };
  execution?: {
    columns?: string[];
    rows?: (string | number | boolean | null)[][];
    nRows?: number;
    elapsed?: number;
    sqlExecuted?: string;
    error?: string;
  };
  answer: string;
}

const TRACES = rawTraces.traces as RawTrace[];
const SYSTEM_PROMPT = rawTraces.systemPromptPreview as string;
const ANSWER_PROMPT = rawTraces.answerSystemPrompt as string;

let traceSeq = 0;
const nextId = () => `t${++traceSeq}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Acentos e caixa fora, para casar pergunta digitada com trace gravado. */
function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Escolhe o trace gravado mais parecido com a pergunta, por sobreposição de termos. */
function pickTrace(question: string): RawTrace {
  const q = new Set(normalize(question).split(" "));
  let best = TRACES[0];
  let bestScore = -1;
  for (const t of TRACES) {
    const words = new Set(normalize(t.question).split(" "));
    let hits = 0;
    for (const w of q) if (words.has(w)) hits++;
    const score = hits / Math.max(1, Math.sqrt(words.size));
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Falhas injetadas por palavra-chave, para exercitar os estados de erro. */
function injectedFailure(question: string): FailureKind | null {
  const q = normalize(question);
  if (q.includes("erro de rede") || q.includes("offline")) return "rede";
  if (q.includes("erro de sql") || q.includes("quebrar sql")) return "sql";
  if (q.includes("timeout") || q.includes("demorar")) return "timeout";
  return null;
}

const FOLLOW_UPS: Record<string, string[]> = {
  default: [
    "E se olharmos só para 2023?",
    "Como isso se distribui por UF?",
    "Qual a taxa de mortalidade nesse recorte?",
  ],
  municipio: [
    "E por UF em vez de município?",
    "Como evoluiu ao longo dos anos?",
    "Qual o custo médio nesses municípios?",
  ],
  custo: [
    "E o custo por faixa etária?",
    "Como isso se compara com a média nacional?",
    "Quais diagnósticos puxam esse custo?",
  ],
  mortalidade: [
    "E entre quem passou pela UTI?",
    "Isso muda por sexo?",
    "Quais diagnósticos têm a maior letalidade?",
  ],
};

function followUpsFor(question: string): string[] {
  const q = normalize(question);
  if (q.includes("municipio")) return FOLLOW_UPS.municipio;
  if (q.includes("custo") || q.includes("gasto") || q.includes("valor")) return FOLLOW_UPS.custo;
  if (q.includes("mortalidade") || q.includes("obito") || q.includes("morte"))
    return FOLLOW_UPS.mortalidade;
  return FOLLOW_UPS.default;
}

/** Divide em pedaços de tamanho variável, imitando tokens de um LLM. */
function tokenize(text: string): string[] {
  const parts = text.match(/\s*\S+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    const take = 1 + (i % 3 === 0 ? 1 : 0);
    out.push(parts.slice(i, i + take).join(""));
    i += take;
  }
  return out;
}

function trace(
  step: StepId,
  title: string,
  body: string,
  format: TraceEntry["format"] = "text",
  elapsed?: number,
): TraceEntry {
  return { id: nextId(), step, title, body, format, at: Date.now(), elapsed };
}

export interface AskOptions {
  /** Multiplicador de velocidade; 0 devolve tudo instantaneamente (útil em teste). */
  speed?: number;
  signal?: AbortSignal;
}

/**
 * Processa uma pergunta e emite os eventos do agente conforme acontecem.
 */
export async function* ask(
  question: string,
  { speed = 1, signal }: AskOptions = {},
): AsyncGenerator<StreamEvent> {
  const pause = (ms: number) => sleep(speed === 0 ? 0 : ms / speed);
  const aborted = () => signal?.aborted ?? false;

  const failure = injectedFailure(question);
  const t = pickTrace(question);

  // ---- 1. Interpretar -----------------------------------------------------
  yield { type: "step", id: "interpretar", state: "ativo" };
  yield {
    type: "trace",
    entry: trace(
      "interpretar",
      "Pergunta recebida",
      question,
      "text",
    ),
  };
  yield {
    type: "trace",
    entry: trace(
      "interpretar",
      "Instruções do sistema (schema + regras críticas)",
      SYSTEM_PROMPT,
      "text",
    ),
  };
  await pause(420);
  if (aborted()) return;
  yield {
    type: "step",
    id: "interpretar",
    state: "concluido",
    elapsed: 0.42,
    detail: `${SYSTEM_PROMPT.length.toLocaleString("pt-BR")} caracteres de contexto`,
  };

  if (failure === "rede") {
    yield { type: "step", id: "vincular", state: "falhou" };
    yield {
      type: "failure",
      kind: "rede",
      message: "Não foi possível falar com o servidor do agente.",
    };
    return;
  }

  // ---- 2. Value linking ---------------------------------------------------
  yield { type: "step", id: "vincular", state: "ativo" };
  const dur = t.durations ?? {};
  await pause(320);
  if (aborted()) return;
  const temHints = t.valueHints.trim().length > 0;
  yield {
    type: "trace",
    entry: trace(
      "vincular",
      temHints ? "Códigos encontrados nas dimensões" : "Nenhum código para vincular",
      temHints
        ? t.valueHints
        : `Termos extraídos: ${t.termos.length ? t.termos.join(", ") : "(nenhum)"}\n\n` +
          "Nenhum termo da pergunta nomeia entidade clínica, então não há códigos a sugerir. " +
          "Isso é o esperado em perguntas puramente analíticas.",
      "text",
      dur.valueLinking,
    ),
  };
  yield {
    type: "step",
    id: "vincular",
    state: temHints ? "concluido" : "pulado",
    elapsed: dur.valueLinking,
    detail: temHints
      ? `${t.termos.length} termo(s): ${t.termos.slice(0, 3).join(", ")}`
      : "nenhuma entidade clínica na pergunta",
  };

  // ---- 3. Gerar SQL -------------------------------------------------------
  yield { type: "step", id: "gerar-sql", state: "ativo" };
  await pause(900);
  if (aborted()) return;
  yield {
    type: "trace",
    entry: trace(
      "gerar-sql",
      "Plano devolvido pelo modelo",
      JSON.stringify(t.plan, null, 2),
      "json",
      dur.sqlGeneration,
    ),
  };

  if (!t.plan.answerable) {
    yield {
      type: "step",
      id: "gerar-sql",
      state: "concluido",
      elapsed: dur.sqlGeneration,
      detail: "a base não tem o dado pedido",
    };
    yield { type: "step", id: "executar", state: "pulado" };
    yield { type: "step", id: "resumir", state: "ativo" };
    yield { type: "refused" };
    for (const tok of tokenize(t.answer)) {
      if (aborted()) return;
      yield { type: "token", text: tok };
      await pause(14);
    }
    yield { type: "step", id: "resumir", state: "concluido" };
    yield { type: "done" };
    return;
  }

  yield {
    type: "step",
    id: "gerar-sql",
    state: "concluido",
    elapsed: dur.sqlGeneration,
    detail: `${t.plan.sql.split("\n").length} linhas de SQL`,
  };
  yield { type: "sql", sql: t.plan.sql };
  if (t.plan.assumptions?.length) {
    yield { type: "assumptions", assumptions: t.plan.assumptions };
  }

  if (failure === "sql") {
    yield { type: "step", id: "executar", state: "falhou" };
    yield {
      type: "trace",
      entry: trace(
        "executar",
        "Erro do DuckDB",
        'Binder Error: Referenced column "DT_ENTRADA" not found in FROM clause!\nCandidate bindings: "DT_INTER", "DT_SAIDA"',
        "text",
      ),
    };
    yield {
      type: "failure",
      kind: "sql",
      message: 'Coluna "DT_ENTRADA" não existe. O agente tentou corrigir duas vezes e não conseguiu.',
    };
    return;
  }

  // ---- 4. Executar --------------------------------------------------------
  yield { type: "step", id: "executar", state: "ativo" };
  yield {
    type: "trace",
    entry: trace(
      "executar",
      "SQL enviado ao DuckDB (com LIMIT de segurança)",
      t.execution?.sqlExecuted ?? t.plan.sql,
      "sql",
    ),
  };

  if (failure === "timeout") {
    await pause(1500);
    yield { type: "step", id: "executar", state: "falhou" };
    yield {
      type: "failure",
      kind: "timeout",
      message: "A consulta passou de 120 segundos e foi interrompida. Tente um recorte menor.",
    };
    return;
  }

  await pause(600);
  if (aborted()) return;
  const exec = t.execution ?? {};
  const result: QueryResult = {
    columns: exec.columns ?? [],
    rows: exec.rows ?? [],
    nRows: exec.nRows ?? 0,
    elapsed: exec.elapsed ?? 0,
  };
  yield {
    type: "step",
    id: "executar",
    state: "concluido",
    elapsed: result.elapsed,
    detail: `${result.nRows.toLocaleString("pt-BR")} linha(s) em ${result.elapsed.toFixed(2)}s`,
  };
  yield { type: "result", result };

  // ---- 5. Resumir ---------------------------------------------------------
  yield { type: "step", id: "resumir", state: "ativo" };
  yield {
    type: "trace",
    entry: trace(
      "resumir",
      "Instruções de redação da resposta",
      ANSWER_PROMPT,
      "text",
    ),
  };
  await pause(300);
  for (const tok of tokenize(t.answer)) {
    if (aborted()) return;
    yield { type: "token", text: tok };
    await pause(16);
  }
  yield {
    type: "step",
    id: "resumir",
    state: "concluido",
    elapsed: dur.synthesis,
  };
  yield { type: "follow-ups", questions: followUpsFor(question) };
  yield { type: "done" };
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
    text: "Quantas internações de mulheres houve em 2019?",
    hint: "contagem simples",
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
