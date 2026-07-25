/** Tipos do domínio. Compartilhados entre a camada de dados e a UI. */

/** As etapas do agente, na ordem em que acontecem. */
export type StepId =
  | "interpretar"
  | "vincular"
  | "gerar-sql"
  | "executar"
  | "resumir";

export type StepState = "pendente" | "ativo" | "concluido" | "falhou" | "pulado";

export interface AgentStep {
  id: StepId;
  label: string;
  state: StepState;
  /** Duração em segundos, preenchida quando a etapa conclui. */
  elapsed?: number;
  /** Uma linha de detalhe mostrada sob o rótulo quando a etapa conclui. */
  detail?: string;
}

export const STEP_LABELS: Record<StepId, string> = {
  interpretar: "Interpretando a pergunta",
  vincular: "Buscando códigos nas dimensões",
  "gerar-sql": "Gerando SQL",
  executar: "Executando no banco",
  resumir: "Redigindo a resposta",
};

/** Entrada do trace de depuração: o que aconteceu, com o conteúdo bruto. */
export interface TraceEntry {
  id: string;
  step: StepId;
  title: string;
  /** Conteúdo textual (prompt montado, SQL, JSON do plano...). */
  body: string;
  /** `sql` e `json` ganham realce; `text` fica em fonte de leitura. */
  format: "text" | "sql" | "json";
  at: number;
  elapsed?: number;
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  nRows: number;
  /** Segundos de execução no DuckDB. */
  elapsed: number;
  /** true quando o backend truncou o conjunto devolvido. */
  truncated?: boolean;
}

/**
 * `sem-trace` é uma falha do MOCK, não do agente: significa que nenhuma
 * resposta gravada corresponde à pergunta. Existe para que o mock nunca
 * devolva a resposta de outra pergunta como se fosse a certa.
 */
export type FailureKind = "rede" | "sql" | "timeout" | "sem-trace";

export interface AgentPayload {
  /** Texto da resposta em linguagem natural. */
  text: string;
  sql?: string;
  result?: QueryResult;
  /** Suposições que o agente registrou ao montar a consulta. */
  assumptions?: string[];
  /** Quando o agente recusa: a base não tem o dado pedido. */
  refused?: boolean;
  /** Perguntas de acompanhamento sugeridas. */
  followUps?: string[];
}

export type Feedback = "util" | "nao-util";

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  at: number;
}

export interface AgentMessage {
  id: string;
  role: "agent";
  /** Texto já recebido — cresce durante o streaming. */
  text: string;
  status: "pensando" | "streaming" | "pronto" | "erro";
  steps: AgentStep[];
  trace: TraceEntry[];
  payload?: Omit<AgentPayload, "text">;
  failure?: { kind: FailureKind; message: string };
  feedback?: Feedback;
  at: number;
  /** Pergunta que originou esta resposta, usada ao regenerar. */
  sourceQuestion: string;
}

export type Message = UserMessage | AgentMessage;

/** Eventos emitidos pela API durante o processamento de uma pergunta. */
export type StreamEvent =
  | { type: "step"; id: StepId; state: StepState; elapsed?: number; detail?: string }
  | { type: "trace"; entry: TraceEntry }
  | { type: "sql"; sql: string }
  | { type: "result"; result: QueryResult }
  | { type: "assumptions"; assumptions: string[] }
  | { type: "token"; text: string }
  | { type: "refused" }
  | { type: "follow-ups"; questions: string[] }
  | { type: "failure"; kind: FailureKind; message: string }
  | { type: "done" };

/* --------------------------------------------------------------------------
   Schema do banco, para o explorador lateral.
   -------------------------------------------------------------------------- */

export interface SchemaColumn {
  name: string;
  type: string;
  desc: string;
}

export interface SchemaTable {
  name: string;
  role: "fato" | "dimensao" | "indisponivel";
  rows: number;
  description: string;
  caveat: string | null;
  empty: boolean;
  forbidden: boolean;
  columns: SchemaColumn[];
  domain: Record<string, string> | null;
}

export interface SchemaRule {
  id: string;
  severity: string;
  text: string;
}

export interface DatabaseSchema {
  tables: SchemaTable[];
  rules: SchemaRule[];
  period: string;
  grain: string;
}
