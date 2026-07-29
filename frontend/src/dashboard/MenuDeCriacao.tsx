import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createFilterManual, createWidgetManual, planDashboardStream } from "@/lib/api";
import type {
  AnalysisPlan,
  PanelCatalog,
  PanelStep,
  PlanItem,
  WidgetDraft,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { CamposDoGrafico, RASCUNHO_VAZIO, ResumoDoGrafico } from "./CamposDoGrafico";
import { Alternador, Campo, ListaDeEtapas, Recusa, SELECT, porGrupo } from "./controles";

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
  const [rascunho, setRascunho] = useState<WidgetDraft>(RASCUNHO_VAZIO);
  const [cor, setCor] = useState("");
  const [rotulos, setRotulos] = useState(false);
  const [legenda, setLegenda] = useState(true);
  const [suave, setSuave] = useState(true);
  const [area, setArea] = useState(false);
  const [empilhar, setEmpilhar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [recusa, setRecusa] = useState("");

  const indicador = !rascunho.field;

  async function criar() {
    setOcupado(true);
    setRecusa("");
    try {
      const r = await createWidgetManual(painelId, {
        ...rascunho,
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
      {/* O MESMO formulário que o editor de widget abre. Duas cópias
          divergiriam, e a divergência apareceria como "editar mudou algo que eu
          não toquei". */}
      <CamposDoGrafico catalogo={catalogo} valor={rascunho} onMudar={setRascunho} />

      {!indicador && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
            Aparência
          </span>
          <Alternador ligado={rotulos} onMudar={setRotulos}>
            valores
          </Alternador>
          {rascunho.series && (
            <Alternador ligado={legenda} onMudar={setLegenda}>
              legenda
            </Alternador>
          )}
          {rascunho.form === "linha" && (
            <>
              <Alternador ligado={suave} onMudar={setSuave}>
                suavizar
              </Alternador>
              <Alternador ligado={area} onMudar={setArea}>
                área
              </Alternador>
            </>
          )}
          {rascunho.form === "barra" && rascunho.series && (
            <Alternador ligado={empilhar} onMudar={setEmpilhar}>
              empilhar
            </Alternador>
          )}
          {/* Sem série, uma cor basta. Com várias, a escolha por série vive no
              editor do widget, onde já se sabe quantas são. */}
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
        <ResumoDoGrafico catalogo={catalogo} valor={rascunho} />
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
      {/* O relato enquanto pensa. Some quando o plano chega: aí o que interessa
          é o plano, e manter as duas listas empilhadas faria a pessoa ler o
          caminho em vez do destino. */}
      {ocupado && etapas.length > 0 && <ListaDeEtapas etapas={etapas} />}

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
