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

export type FailureKind = "rede" | "sql" | "timeout" | "offline";

/** Formas que o agente pode pedir. Espelha o enum do SQL_SCHEMA no backend. */
export type ChartKind =
  | "linha"
  | "barra"
  | "barra_horizontal"
  | "pizza"
  | "dispersao"
  | "heatmap"
  | "empilhada_100";

/**
 * O que o agente declara sobre o gráfico. Ele escolhe a FORMA e as COLUNAS;
 * os pontos são montados no cliente a partir das linhas do resultado, então o
 * gráfico nunca contém um número que a consulta não devolveu.
 *
 * `x`, `y` e `series` já vêm conferidos contra `result.columns` pelo backend.
 */
export interface ChartSpec {
  kind: ChartKind;
  x: string;
  y: string;
  series: string | null;
  title: string;
  /** Uma frase do agente justificando a forma escolhida. */
  reason: string;
}

/** Uma rodada anterior, enviada ao backend para resolver acompanhamentos. */
export interface Turn {
  question: string;
  sql: string | null;
}

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
  /** Gráfico declarado pelo agente, quando a forma do resultado permite. */
  chart?: ChartSpec;
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
  | { type: "chart"; chart: ChartSpec }
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

/* --------------------------------------------------------------------------
   Investigação: várias consultas para uma pergunta só.
   Espelha src/investigation/report.py — mudou lá, muda aqui.
   -------------------------------------------------------------------------- */

export type InvestigationPhase =
  | "planejar"
  | "executar"
  | "refletir"
  | "aprofundar"
  | "sintetizar";

export type PhaseState = "ativo" | "concluido" | "recusado";

/** Uma etapa executada: a evidência, com o papel que ela cumpre no argumento. */
export interface ReportBlock {
  question: string;
  purpose: string;
  /** "reflexao" = existe porque o argumento tinha um buraco. */
  origin: "plano" | "reflexao";
  sql: string | null;
  error: string | null;
  /** O recorte que a query aplicou, em português. Sem isto o número está certo
   *  e o rótulo pode estar errado — "câncer" que inclui neoplasia benigna. */
  definition: string;
  assumptions: string[];
  chart: ChartSpec | null;
  result: QueryResult | null;
}

export interface Report {
  question: string;
  reading: string;
  text: string;
  /** Lacuna que a investigação NÃO conseguiu fechar. */
  gap: string;
  refusal: string;
  elapsed: number;
  llmCalls: number;
  stepsOk: number;
  stepsFromReflection: number;
  blocks: ReportBlock[];
}

export type InvestigationEvent =
  | {
      type: "phase";
      phase: InvestigationPhase;
      state: PhaseState;
      reading?: string;
      steps?: { question: string; purpose: string }[];
      ok?: number;
      total?: number;
      extra?: number;
      gap?: string;
      defects?: string[];
    }
  | { type: "block"; block: ReportBlock }
  | { type: "report"; report: Report }
  | { type: "refused"; reason: string }
  | { type: "failure"; message: string }
  | { type: "done" };

export const PHASE_LABELS: Record<InvestigationPhase, string> = {
  planejar: "Planejando a investigação",
  executar: "Executando as consultas",
  refletir: "Revisando o argumento",
  aprofundar: "Fechando as lacunas",
  sintetizar: "Escrevendo o relatório",
};

/* --------------------------------------------------------------------------
   Definição de conceito: o que um termo clínico significa NESTA base.
   Espelha src/concepts.py.
   -------------------------------------------------------------------------- */

export interface ConceptCandidate {
  source: "procedimento" | "cid";
  /** Coluna do fato onde o código é filtrado. `DIAG_PRINC_CAT` filtra por
   *  LEFT(DIAG_PRINC,3) — categoria CID em vez de subcategoria. */
  column: "PROC_REA" | "DIAG_PRINC" | "DIAG_PRINC_CAT";
  code: string;
  description: string;
  admissions: number;
  /** Proposta do modelo. O usuário decide. */
  suggested: boolean;
  /** Por que ficou de fora, quando ficou. */
  note: string;
}

export interface Concept {
  term: string;
  /** Armadilha conhecida deste termo nesta base. Vazio quando não há. */
  alert: string;
  /** CONTAGEM da seleção, nunca a soma dos candidatos — procedimento e
   *  diagnóstico descrevem as mesmas internações. */
  total: number;
  candidates: ConceptCandidate[];
}
