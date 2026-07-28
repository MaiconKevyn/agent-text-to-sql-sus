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

  /* -- Aparência, escolhida por quem olha ---------------------------------
     Opcionais e ausentes em tudo que foi criado antes: cada leitura cai no
     padrão da paleta, e um gráfico antigo continua igual ao que era. */

  /**
   * Cores fora da paleta, na ordem das séries. `null` — o normal — usa a paleta
   * do tema, que é validada para daltonismo e para o contraste do fundo. Uma
   * cor escolhida à mão não passa por essa validação, e é por isso que ela é a
   * exceção e não o padrão.
   */
  colors?: string[] | null;
  /** Número em cima de cada marca. Ilegível acima de ~15 categorias. */
  showLabels?: boolean;
  showLegend?: boolean;
  /** Linha: suavizada ou reta. Reta é mais honesta com poucos pontos. */
  smooth?: boolean;
  /** Linha: preenche a área sob a curva. */
  area?: boolean;
  /** Barra com série: empilha em valor absoluto (a 100% é uma forma à parte). */
  stack?: boolean;
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
  /** O que o agente fez com a pergunta anterior. Ausente na 1ª pergunta. */
  continuity?: Continuity;
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
  | { type: "continuity"; continuity: Continuity }
  | { type: "token"; text: string }
  | { type: "refused" }
  | { type: "follow-ups"; questions: string[] }
  | { type: "failure"; kind: FailureKind; message: string }
  // Só no chat do tema: para onde a pergunta foi, e o que a busca trouxe.
  | {
      type: "route";
      destination: "tema" | "banco" | "web" | "ambos";
      /** Em "tema", os blocos escolhidos como fonte. */
      blocks: string[];
      /** Em "ambos", a metade que foi para o SQL; vazio nos outros destinos. */
      dbQuestion: string;
      query: string;
      reason: string;
    }
  | { type: "search"; query: string; domains: string[]; candidates: SearchCandidate[] }
  /** A resposta veio dos blocos já fixados, com os ids que ela cita. */
  | { type: "theme_answer"; answered: boolean; text: string; cited: string[]; reason: string }
  /** O tema foi tentado e não respondeu — a pergunta segue para o banco. */
  | { type: "theme_miss"; reason: string }
  | { type: "search_failed"; message: string }
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

/**
 * O que o agente fez com a pergunta anterior. Só existe quando havia histórico.
 *
 * A decisão "isto continua o assunto anterior?" sempre foi tomada, mas era
 * invisível — e quando ela erra, a resposta sai igualmente convincente. Depois
 * de "quantas mortes por covid?", a pergunta "em quais estados tiveram mais
 * mortes?" devolvia 903.064 (todas as causas) em vez de 38.884 (covid), sem
 * nenhum sinal de que o filtro tinha sido descartado.
 */
export interface Continuity {
  kind: "acompanhamento" | "nova";
  /** Recortes da pergunta anterior que foram mantidos. */
  kept: string[];
  /** Recortes descartados. É o campo que mais importa ver. */
  dropped: string[];
}

/* --------------------------------------------------------------------------
   Tema de investigação: espaço que acumula evidência sobre um assunto.
   Espelha src/themes/models.py.
   -------------------------------------------------------------------------- */

/** De onde veio o conteúdo. Hoje só "banco"; os outros são o item 4. */
export type Provenance = "banco" | "web" | "arquivo" | "usuario";
export type BlockKind = "consulta" | "investigacao" | "nota";

/** Separado de `kind` porque são perguntas diferentes: `kind` é de onde veio,
 *  `format` é o que o leitor vê. A mesma consulta de uma linha pode ser um
 *  número grande ou uma tabela. */
export type BlockFormat = "auto" | "indicador" | "grafico" | "tabela" | "citacao";

/** A grade do painel. Definidas em theme/grade.ts, que não depende de nada e
 *  por isso roda direto no Node; espelham as constantes de themes/models.py. */
export {
  ALTURA_MAX,
  ALTURA_MIN,
  COLUNAS,
  LARGURA_MIN,
  LINHA_PX,
  VAO_PX,
} from "@/theme/grade";

export interface ThemeBlock {
  id: string;
  kind: BlockKind;
  provenance: Provenance;
  title: string;
  question: string;
  text: string;
  sql: string | null;
  result: QueryResult | null;
  chart: ChartSpec | null;
  definition: string;
  assumptions: string[];
  /** Anotação de quem investiga — o porquê de o bloco estar aqui. */
  note: string;
  /** De onde veio, quando não é do banco. É o que torna a citação conferível. */
  sourceUrl: string;
  sourceTitle: string;
  accessedAt: string;
  /** COMO o bloco se apresenta. `auto` deixa a interface escolher. */
  format: BlockFormat;
  /** Quanto ocupa na grade: colunas de LARGURA_MIN a COLUNAS, altura em linhas. */
  width: number;
  height: number;
  /** Onde fica, em células. Explícito e não deduzido da ordem — é o que deixa
   *  um bloco parado onde foi solto, mesmo com espaço vazio ao lado. */
  x: number;
  y: number;
  /** Quanto ocupa na grade de três colunas. */
  pinnedAt: string;
}

/** Um termo resolvido, válido para o tema inteiro. */
export interface ThemeDefinition {
  term: string;
  clause: string;
  codes: { code: string; column: string }[];
  total: number;
  createdAt: string;
}

export interface Theme {
  id: string;
  /** Paleta própria deste tema; vazio usa a do site. */
  palette?: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  definitions: ThemeDefinition[];
  blockCount: number;
  /** Ausente na listagem, que não carrega as tabelas de cada bloco. */
  blocks?: ThemeBlock[];
}

/* --------------------------------------------------------------------------
   Conversa salva. Rascunho, não artefato — ver src/chats/models.py.
   -------------------------------------------------------------------------- */

export interface ChatTurn {
  question: string;
  text: string;
  sql: string | null;
  result: QueryResult | null;
  chart: ChartSpec | null;
  assumptions: string[];
  continuity: Continuity | null;
  at: string;
}

export interface SavedChat {
  id: string;
  /** Sai da primeira pergunta. Vazio só antes da primeira rodada. */
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  /** Ausente na listagem. */
  turns?: ChatTurn[];
}

/* --------------------------------------------------------------------------
   Busca em fontes confiáveis. Devolve candidatos, nunca respostas.
   -------------------------------------------------------------------------- */

export interface SearchCandidate {
  title: string;
  url: string;
  /** Trecho da página. É ele que vira a citação — nunca um resumo. */
  excerpt: string;
  domain: string;
  publishedAt: string;
  score: number;
}

export interface SearchResult {
  query: string;
  /** A lista branca ativa, para o usuário saber onde se buscou. */
  domains: string[];
  candidates: SearchCandidate[];
}

/* --------------------------------------------------------------------------
   Painel: mostradores com filtros. O oposto do tema — ver src/paineis/models.py.
   -------------------------------------------------------------------------- */

/** Um filtro declarado: ancorado numa coluna real, criado em tempo de uso. */
export interface FilterOption {
  value: string | number;
  label: string;
  /** Quantas internações têm esse valor. Diz quando uma opção é resíduo. */
  count: number;
}

export interface PanelFilter {
  id: string;
  label: string;
  kind: FilterKind;
  /** A expressão booleana com `?`. Só aparece no detalhe. */
  fragment: string;
  /** Número em "faixa", data ISO ("2007-08-01") em "data". */
  min: number | string | null;
  max: number | string | null;
  options: FilterOption[];
  selection: (string | number)[];
  /** O que os valores significam nesta base. Nem sempre é adivinhável. */
  note: string;
  /** Se está de fato recortando. Seleção completa = inativo. */
  active: boolean;
}

export interface DashboardWidget {
  id: string;
  title: string;
  question: string;
  /** Com o token dos filtros. Só aparece no detalhe. */
  sql: string;
  chart: ChartSpec | null;
  format: "grafico" | "indicador";
  assumptions: string[];
  /** Criado antes dos filtros configuráveis: não responde a nenhum. */
  legacy: boolean;
  /** Filtros do painel que ESTE widget dispensa. Vazio = obedece a todos. */
  excluded: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface Dashboard {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  filters: PanelFilter[];
  widgetCount: number;
  widgets?: DashboardWidget[];
}

/* --------------------------------------------------------------------------
   O catálogo do menu manual.

   Ele vem do servidor e não do cliente porque é o MESMO objeto que monta o SQL
   lá. Duplicar a lista aqui criaria duas verdades sobre quais colunas existem,
   e a que a tela mostra é sempre a que erra por último.
   -------------------------------------------------------------------------- */

export type FilterKind = "faixa" | "data" | "escolha" | "multipla";

export interface CatalogField {
  id: string;
  label: string;
  /** "Tempo", "Paciente", "Clínico", "Atendimento", "Geografia". */
  group: string;
  type: "categoria" | "numero";
  /** Tipos de controle que este campo aceita. Vazio = só serve para agrupar. */
  filters: FilterKind[];
  /** Valores distintos; 0 quando são muitos. */
  distinct: number;
  note: string;
  /** Poucas categorias o bastante para virar série sem estourar a legenda. */
  canSeries: boolean;
  /** Se serve de eixo. Data crua só recorta: agrupar daria uma barra por dia. */
  canGroup: boolean;
  /** Tempo e faixas: o eixo sai em ordem de categoria, não de valor. */
  ordinal: boolean;
}

export interface CatalogMeasure {
  id: string;
  label: string;
  /** "%" ou "R$", quando muda como o número se lê. */
  unit: string;
  /** Piso de casos por grupo. Só as taxas têm. */
  minCases: number;
  note: string;
}

export interface CatalogForm {
  id: ChartKind;
  label: string;
  needsSeries: boolean;
  /** 0 = sem teto. Pizza tem 8. */
  maxCategories: number;
}

export interface PanelCatalog {
  fields: CatalogField[];
  measures: CatalogMeasure[];
  forms: CatalogForm[];
  orders: { id: string; label: string }[];
  filterKinds: { id: FilterKind; label: string }[];
}

/** O que a tela envia para montar um gráfico. Ids do catálogo, nunca SQL. */
export interface WidgetDraft {
  measure: string;
  /** Vazio = indicador: um número só, sem eixo. */
  field: string;
  series: string;
  form: ChartKind;
  order: string;
  limit: number;
  title: string;
  appearance?: Partial<ChartSpec>;
}

/* --------------------------------------------------------------------------
   O plano de uma análise completa.
   -------------------------------------------------------------------------- */

export interface PlanItem {
  kind: "indicador" | "grafico" | "filtro";
  /** A frase que será executada sozinha. Carrega o assunto por extenso. */
  request: string;
  why: string;
}

export interface AnalysisPlan {
  title: string;
  /** O que a base permite ver sobre o assunto, e o que não permite. */
  reasoning: string;
  items: PlanItem[];
  refused: string;
}

/** O resultado de rodar um widget sob os filtros atuais. */
export interface WidgetData {
  id: string;
  legacy: boolean;
  /** Filtros ATIVOS que este widget dispensou. Sem isto, um gráfico parado não
   *  se distingue de um dado plano. */
  dispensados: string[];
  error: string | null;
  result: QueryResult | null;
}
