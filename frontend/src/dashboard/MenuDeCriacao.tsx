import { Check, Info, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createFilterManual, createWidgetManual, planDashboardStream } from "@/lib/api";
import type {
  AnalysisPlan,
  CatalogField,
  ChartKind,
  PanelStep,
  PanelCatalog,
  PlanItem,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Aba = "grafico" | "filtro" | "analise";

interface Props {
  painelId: string;
  catalogo: PanelCatalog;
  onCriado: () => void;
  /** Os itens do plano viram tarefas na fila — quem enfileira é a página. */
  onPlano: (plano: AnalysisPlan, itens: PlanItem[]) => void;
  onFechar: () => void;
}

const ABAS: { id: Aba; rotulo: string; dica: string }[] = [
  { id: "grafico", rotulo: "Gráfico", dica: "Escolha a medida e o eixo" },
  { id: "filtro", rotulo: "Filtro", dica: "Um controle que recorta todos os gráficos" },
  { id: "analise", rotulo: "Análise completa", dica: "Um assunto vira um painel inteiro" },
];

/**
 * O menu manual: montar sem escrever nada.
 *
 * A caixa em linguagem natural continua sendo o caminho rápido, e este menu não
 * a substitui — ele resolve o que ela não resolve. Quando a pessoa sabe
 * exatamente o que quer ("mortalidade por faixa etária separada por sexo, em
 * barras 100%"), descrever isso em português e torcer para a classificação
 * acertar é mais trabalho que escolher em quatro menus. E aqui não há nada a
 * torcer: sem modelo no caminho, o mesmo par de escolhas produz sempre o mesmo
 * gráfico.
 *
 * As opções não são escritas aqui. Elas vêm do catálogo do servidor, que é o
 * mesmo objeto que monta o SQL — duplicar a lista no cliente criaria duas
 * verdades sobre quais colunas existem, e a da tela é sempre a que erra por
 * último.
 */
export function MenuDeCriacao({ painelId, catalogo, onCriado, onPlano, onFechar }: Props) {
  const [aba, setAba] = useState<Aba>("grafico");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:p-8"
      onPointerDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div
        role="dialog"
        aria-label="Adicionar ao painel"
        className="w-full max-w-2xl rounded-xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center gap-1 border-b border-line px-3 py-2">
          {ABAS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              aria-current={aba === a.id}
              title={a.dica}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors duration-150",
                aba === a.id
                  ? "bg-accent-soft text-accent"
                  : "text-ink-muted hover:bg-raised hover:text-ink",
              )}
            >
              {a.rotulo}
            </button>
          ))}
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="ml-auto rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-ink"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </header>

        {aba === "grafico" && (
          <AbaGrafico painelId={painelId} catalogo={catalogo} onCriado={onCriado} />
        )}
        {aba === "filtro" && (
          <AbaFiltro painelId={painelId} catalogo={catalogo} onCriado={onCriado} />
        )}
        {aba === "analise" && <AbaAnalise painelId={painelId} onPlano={onPlano} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/** Um `<select>` de verdade: teclado, leitor de tela e busca por digitação. */
function Campo({
  rotulo,
  children,
  dica,
}: {
  rotulo: string;
  children: React.ReactNode;
  dica?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        {rotulo}
        {dica && (
          <span title={dica} className="cursor-help">
            <Info aria-hidden className="h-3 w-3" />
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

const SELECT =
  "w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12.5px] text-ink outline-none transition-colors duration-150 focus:border-accent";

function porGrupo(campos: CatalogField[]): [string, CatalogField[]][] {
  const mapa = new Map<string, CatalogField[]>();
  for (const c of campos) mapa.set(c.group, [...(mapa.get(c.group) ?? []), c]);
  return [...mapa.entries()];
}

function Alternador({
  ligado,
  onMudar,
  children,
}: {
  ligado: boolean;
  onMudar: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onMudar(!ligado)}
      aria-pressed={ligado}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors duration-150",
        ligado ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-muted hover:text-ink",
      )}
    >
      <span
        className={cn(
          "flex h-3 w-3 items-center justify-center rounded-sm border",
          ligado ? "border-accent bg-accent text-white" : "border-line",
        )}
      >
        {ligado && <Check aria-hidden className="h-2 w-2" strokeWidth={4} />}
      </span>
      {children}
    </button>
  );
}

function Recusa({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <p className="rounded-lg bg-caution-soft px-3 py-2 text-[11.5px] leading-relaxed text-ink">
      {texto}
    </p>
  );
}

/* ------------------------------------------------------------------------- */

function AbaGrafico({
  painelId,
  catalogo,
  onCriado,
}: {
  painelId: string;
  catalogo: PanelCatalog;
  onCriado: () => void;
}) {
  const [medida, setMedida] = useState(catalogo.measures[0]?.id ?? "internacoes");
  const [campo, setCampo] = useState("ano");
  const [serie, setSerie] = useState("");
  const [forma, setForma] = useState<ChartKind>("linha");
  const [ordem, setOrdem] = useState("valor_desc");
  const [limite, setLimite] = useState(15);
  const [titulo, setTitulo] = useState("");
  const [cor, setCor] = useState("");
  const [rotulos, setRotulos] = useState(false);
  const [legenda, setLegenda] = useState(true);
  const [suave, setSuave] = useState(true);
  const [area, setArea] = useState(false);
  const [empilhar, setEmpilhar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [recusa, setRecusa] = useState("");

  const m = catalogo.measures.find((x) => x.id === medida);
  const c = catalogo.fields.find((x) => x.id === campo);
  const s = catalogo.fields.find((x) => x.id === serie);
  const indicador = !campo;

  // Séries possíveis: só as de poucas categorias, e nunca o próprio eixo.
  const seriesPossiveis = catalogo.fields.filter((f) => f.canSeries && f.id !== campo);
  useEffect(() => {
    if (serie && !seriesPossiveis.some((f) => f.id === serie)) setSerie("");
  }, [campo, serie, seriesPossiveis]);

  // Uma forma que exige série fica impossível sem ela; se estava escolhida,
  // volta para barras em vez de deixar o botão "Adicionar" recusando sozinho.
  const formaAtual = catalogo.forms.find((f) => f.id === forma);
  useEffect(() => {
    if (formaAtual?.needsSeries && !serie) setForma("barra");
  }, [serie, formaAtual]);

  async function criar() {
    setOcupado(true);
    setRecusa("");
    try {
      const r = await createWidgetManual(painelId, {
        measure: medida,
        field: campo,
        series: serie,
        form: forma,
        order: ordem,
        limit: limite,
        title: titulo,
        appearance: {
          colors: cor ? [cor] : null,
          showLabels: rotulos,
          showLegend: legenda,
          smooth: suave,
          area,
          stack: empilhar,
        },
      });
      if (r.refused) setRecusa(r.refused);
      else onCriado();
    } catch (e) {
      setRecusa(String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Medida" dica={m?.note}>
          <select value={medida} onChange={(e) => setMedida(e.target.value)} className={SELECT}>
            {catalogo.measures.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Agrupar por" dica={c?.note}>
          <select value={campo} onChange={(e) => setCampo(e.target.value)} className={SELECT}>
            <option value="">— nenhum: só o número —</option>
            {/* `canGroup` tira do eixo o que só serve para recortar: agrupar
                por data crua daria 5.844 barras, uma por dia da base. */}
            {porGrupo(catalogo.fields.filter((f) => f.canGroup)).map(([grupo, campos]) => (
              <optgroup key={grupo} label={grupo}>
                {campos.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Campo>
      </div>

      {!indicador && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo="Separar em séries"
              dica={s?.note ?? "Só campos com poucas categorias: acima de doze, a legenda fica maior que o gráfico."}
            >
              <select value={serie} onChange={(e) => setSerie(e.target.value)} className={SELECT}>
                <option value="">— série única —</option>
                {seriesPossiveis.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Forma">
              <div className="flex flex-wrap gap-1">
                {catalogo.forms.map((f) => {
                  const bloqueada = f.needsSeries && !serie;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={bloqueada}
                      onClick={() => setForma(f.id)}
                      aria-pressed={forma === f.id}
                      title={bloqueada ? `${f.label} exige uma série` : f.label}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[11.5px] transition-colors duration-150",
                        forma === f.id
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line text-ink-muted hover:text-ink",
                        bloqueada && "cursor-not-allowed opacity-35 hover:text-ink-muted",
                      )}
                    >
                      {f.label.replace(/ \(.*\)/, "")}
                    </button>
                  );
                })}
              </div>
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo="Ordem"
              dica={
                c?.ordinal
                  ? "Este campo é ordinal: o eixo sai em ordem de categoria de qualquer forma, senão a linha ligaria anos fora de ordem."
                  : undefined
              }
            >
              <select
                value={ordem}
                onChange={(e) => setOrdem(e.target.value)}
                disabled={!!serie}
                className={cn(SELECT, serie && "opacity-50")}
                title={serie ? "Com série, o eixo ordena pela categoria" : undefined}
              >
                {catalogo.orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo={`Quantas categorias — ${limite}`}>
              <input
                type="range"
                min={3}
                max={60}
                value={limite}
                onChange={(e) => setLimite(Number(e.target.value))}
                className="h-1 w-full cursor-pointer accent-[hsl(var(--accent))]"
                aria-label="Quantas categorias"
              />
            </Campo>
          </div>
        </>
      )}

      <Campo rotulo="Título">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={m && c ? `${m.label} por ${c.label}` : (m?.label ?? "")}
          className={SELECT}
        />
      </Campo>

      {!indicador && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
            Aparência
          </span>
          <Alternador ligado={rotulos} onMudar={setRotulos}>
            valores
          </Alternador>
          {serie && (
            <Alternador ligado={legenda} onMudar={setLegenda}>
              legenda
            </Alternador>
          )}
          {forma === "linha" && (
            <>
              <Alternador ligado={suave} onMudar={setSuave}>
                suavizar
              </Alternador>
              <Alternador ligado={area} onMudar={setArea}>
                área
              </Alternador>
            </>
          )}
          {forma === "barra" && serie && (
            <Alternador ligado={empilhar} onMudar={setEmpilhar}>
              empilhar
            </Alternador>
          )}
          {/* Sem série, uma cor basta. Com várias, a escolha por série vive no
              ajuste do widget, onde já se sabe quantas são. */}
          <label className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11.5px] text-ink-muted">
            cor
            <input
              type="color"
              value={cor || "#4a7fd4"}
              onChange={(e) => setCor(e.target.value)}
              aria-label="Cor principal do gráfico"
              className="h-4 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            {cor && (
              <button
                type="button"
                onClick={() => setCor("")}
                title="Voltar para a cor da paleta, que é validada para daltonismo"
                className="text-ink-subtle hover:text-ink"
              >
                <X aria-hidden className="h-3 w-3" />
              </button>
            )}
          </label>
        </div>
      )}

      <Recusa texto={recusa} />

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-subtle">
          {m && (indicador ? m.label : `${m.label} por ${c?.label}`)}
          {s && `, separado por ${s.label}`}
          {m && m.minCases > 0 && (
            <span className="text-caution">
              {" "}
              · grupos com menos de {m.minCases.toLocaleString("pt-BR")} internações ficam de fora
            </span>
          )}
        </p>
        <button
          onClick={criar}
          disabled={ocupado}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
        >
          {ocupado ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : "Adicionar"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AbaFiltro({
  painelId,
  catalogo,
  onCriado,
}: {
  painelId: string;
  catalogo: PanelCatalog;
  onCriado: () => void;
}) {
  const filtraveis = useMemo(
    () => catalogo.fields.filter((f) => f.filters.length > 0),
    [catalogo.fields],
  );
  const [campo, setCampo] = useState(filtraveis[0]?.id ?? "");
  const c = filtraveis.find((x) => x.id === campo);
  const [tipo, setTipo] = useState(c?.filters[0] ?? "multipla");
  const [rotulo, setRotulo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recusa, setRecusa] = useState("");

  // Trocar de campo pode invalidar o controle: idade não aceita "marcar
  // vários", e deixar o tipo antigo faria o botão recusar sem explicar.
  useEffect(() => {
    if (c && !c.filters.includes(tipo)) setTipo(c.filters[0]);
  }, [c, tipo]);

  async function criar() {
    setOcupado(true);
    setRecusa("");
    try {
      const r = await createFilterManual(painelId, campo, tipo, rotulo);
      if (r.refused) setRecusa(r.refused);
      else onCriado();
    } catch (e) {
      setRecusa(String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Coluna">
          <select value={campo} onChange={(e) => setCampo(e.target.value)} className={SELECT}>
            {porGrupo(filtraveis).map(([grupo, campos]) => (
              <optgroup key={grupo} label={grupo}>
                {campos.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Tipo de controle">
          <div className="flex flex-wrap gap-1">
            {catalogo.filterKinds.map((k) => {
              const cabe = c?.filters.includes(k.id);
              return (
                <button
                  key={k.id}
                  type="button"
                  disabled={!cabe}
                  onClick={() => setTipo(k.id)}
                  aria-pressed={tipo === k.id}
                  title={cabe ? k.label : `${c?.label} não aceita este controle`}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-[11.5px] transition-colors duration-150",
                    tipo === k.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-muted hover:text-ink",
                    !cabe && "cursor-not-allowed opacity-35 hover:text-ink-muted",
                  )}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </Campo>
      </div>

      <Campo rotulo="Nome na tela">
        <input
          value={rotulo}
          onChange={(e) => setRotulo(e.target.value)}
          placeholder={c?.label ?? ""}
          className={SELECT}
        />
      </Campo>

      {c?.note && (
        <p className="rounded-lg bg-raised px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted">
          {c.note}
        </p>
      )}

      <Recusa texto={recusa} />

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-subtle">
          As opções são lidas do banco na criação, com a contagem de cada uma. O filtro
          nasce sem recortar nada e vale para todos os gráficos.
        </p>
        <button
          onClick={criar}
          disabled={ocupado || !campo}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
        >
          {ocupado ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : "Criar filtro"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

const EXEMPLOS = [
  "uma análise completa sobre óbitos de covid",
  "as principais causas de AVC e a mortalidade delas",
  "um panorama das internações por câncer nos últimos cinco anos",
  "análise de partos e nascimentos no SUS",
];

function AbaAnalise({
  painelId,
  onPlano,
}: {
  painelId: string;
  onPlano: (plano: AnalysisPlan, itens: PlanItem[]) => void;
}) {
  const [assunto, setAssunto] = useState("");
  const [plano, setPlano] = useState<AnalysisPlan | null>(null);
  const [fora, setFora] = useState<Set<number>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  // O que o servidor já relatou. Planejar leva de um a dois minutos, e nesse
  // tempo o botão dizia só "Pensando…" — que não distingue pensar de travar.
  const [etapas, setEtapas] = useState<PanelStep[]>([]);

  async function planejar() {
    setOcupado(true);
    setErro("");
    setPlano(null);
    setFora(new Set());
    setEtapas([]);
    try {
      const p = await planDashboardStream(painelId, assunto.trim(), (passo) =>
        setEtapas((atual) => {
          const i = atual.findIndex((e) => e.id === passo.id);
          return i >= 0 ? atual.map((e, k) => (k === i ? passo : e)) : [...atual, passo];
        }),
      );
      if (p.refused) setErro(p.refused);
      else setPlano(p);
    } catch (e) {
      setErro(String(e));
    } finally {
      setOcupado(false);
    }
  }

  const escolhidos = plano?.items.filter((_, i) => !fora.has(i)) ?? [];

  return (
    <div className="space-y-3 p-4">
      <Campo rotulo="Assunto da análise">
        <textarea
          value={assunto}
          onChange={(e) => setAssunto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void planejar();
          }}
          rows={2}
          placeholder="crie uma análise completa sobre óbitos de covid"
          className={cn(SELECT, "resize-none leading-relaxed")}
        />
      </Campo>

      {!plano && (
        <div className="flex flex-wrap gap-1">
          {EXEMPLOS.map((x) => (
            <button
              key={x}
              onClick={() => setAssunto(x)}
              className="rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
            >
              {x}
            </button>
          ))}
        </div>
      )}

      {/* O relato enquanto pensa. Some quando o plano chega: aí o que interessa
          é o plano, e manter as duas listas empilhadas faria a pessoa ler o
          caminho em vez do destino. */}
      {ocupado && etapas.length > 0 && (
        <ol className="ml-[3px] space-y-1 border-l border-line pl-3">
          {etapas.map((e) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden
                className={cn(
                  "absolute -left-[17px] top-[5px] h-[7px] w-[7px] rounded-full border",
                  e.state === "feita" && "border-positive bg-positive",
                  e.state === "fazendo" && "border-accent bg-accent",
                  e.state === "falhou" && "border-critical bg-critical",
                )}
              />
              <span
                className={cn(
                  "text-[11.5px] leading-snug",
                  e.state === "fazendo" ? "text-ink" : "text-ink-muted",
                )}
              >
                {e.label}
              </span>
              {e.detail && (
                <span className="block text-[10.5px] leading-snug text-ink-subtle">
                  {e.detail}
                </span>
              )}
              {e.state === "fazendo" && (
                <span
                  aria-hidden
                  className="mt-1 block h-px w-full overflow-hidden rounded bg-line"
                >
                  <span className="block h-full w-1/4 animate-varre rounded bg-accent" />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {erro && <Recusa texto={erro} />}

      {plano && (
        <div className="space-y-2 rounded-xl border border-line bg-canvas p-3">
          <h3 className="text-[13px] font-semibold text-ink">{plano.title}</h3>
          {plano.reasoning && (
            <p className="text-[11.5px] leading-relaxed text-ink-muted">{plano.reasoning}</p>
          )}
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {plano.items.map((it, idx) => {
              const dentro = !fora.has(idx);
              return (
                <li key={idx}>
                  <button
                    onClick={() =>
                      setFora((s) => {
                        const n = new Set(s);
                        if (n.has(idx)) n.delete(idx);
                        else n.add(idx);
                        return n;
                      })
                    }
                    aria-pressed={dentro}
                    className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors duration-150 hover:bg-raised"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        dentro ? "border-accent bg-accent text-white" : "border-line",
                      )}
                    >
                      {dentro && <Check aria-hidden className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-[12px] leading-snug",
                          dentro ? "text-ink" : "text-ink-subtle line-through",
                        )}
                      >
                        {it.request}
                      </span>
                      {it.why && (
                        <span className="block text-[10.5px] leading-snug text-ink-subtle">
                          {it.why}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 rounded bg-raised px-1 py-px text-[9.5px] uppercase tracking-wide text-ink-subtle">
                      {it.kind}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-subtle">
          {plano
            ? "Cada item vira uma tarefa na fila, três de cada vez. Dá para desmarcar o que não interessa antes de disparar."
            : "O modelo lê o dicionário do banco antes de responder, e diz o que a base NÃO permite ver sobre o assunto."}
        </p>
        {plano ? (
          <button
            onClick={() => onPlano(plano, escolhidos)}
            disabled={escolhidos.length === 0}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
          >
            Criar {escolhidos.length} {escolhidos.length === 1 ? "item" : "itens"}
          </button>
        ) : (
          <button
            onClick={planejar}
            disabled={ocupado || assunto.trim().length < 8}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
          >
            {ocupado ? (
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles aria-hidden className="h-3.5 w-3.5" />
            )}
            {ocupado ? "Pensando…" : "Planejar"}
          </button>
        )}
      </div>
    </div>
  );
}
