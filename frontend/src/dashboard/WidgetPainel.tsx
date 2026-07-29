import { ChevronDown, GripVertical, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { ResultChart } from "@/components/result/ResultChart";
import { SqlBlock } from "@/components/result/SqlBlock";
import { cn } from "@/lib/utils";
import type {
  ChartSpec,
  DashboardWidget,
  PanelCatalog,
  PanelFilter,
  WidgetData,
  WidgetDisplay,
  WidgetDraft,
} from "@/lib/types";
import { EditorDeWidget } from "./EditorDeWidget";
import { LupaDeFiltros } from "./LupaDeFiltros";
import type { Celula } from "@/theme/grade";
import type { Gesto } from "@/theme/usePainel";

const nf = new Intl.NumberFormat("pt-BR");

interface Props {
  widget: DashboardWidget;
  dados: WidgetData | undefined;
  carregando: boolean;
  onRemover: () => void;
  onRecriar: () => void;
  filtros: PanelFilter[];
  onAlternarFiltro: (filtroId: string) => void;
  celula: Celula;
  gesto: Gesto | null;
  comecar: (id: string, tipo: Gesto, e: React.PointerEvent) => void;
  porTeclado: (id: string, d: Partial<Celula>) => void;
  catalogo: PanelCatalog | null;
  /** Cada uma devolve a recusa, ou string vazia. */
  onRefazer: (draft: WidgetDraft) => Promise<string>;
  onAparencia: (patch: Partial<ChartSpec>) => Promise<string>;
  onExibicao: (d: WidgetDisplay) => Promise<string>;
}

/**
 * Um mostrador do painel: gráfico ou número, recalculado a cada filtro.
 *
 * A diferença visível para o bloco de um tema é o AVISO DO QUE ELE IGNORA. Um
 * widget sem coluna de data não pode responder ao filtro de período, e precisa
 * dizer isso — senão quem move a data vê três gráficos mudarem e dois não, e
 * conclui que os dois não mudaram por causa do dado. É assim que um painel mente
 * sem ninguém mentir.
 */
export function WidgetPainel({
  widget,
  dados,
  carregando,
  onRemover,
  onRecriar,
  filtros,
  onAlternarFiltro,
  celula,
  gesto,
  comecar,
  porTeclado,
  catalogo,
  onRefazer,
  onAparencia,
  onExibicao,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const emMovimento = gesto === "mover";
  const emResize = gesto !== null && gesto !== "mover";
  const res = dados?.result;
  // COMPACTO tira o rodapé e o rótulo da coluna: sobram título e número, que é
  // o que se quer ler numa fila de quatro indicadores. Sem isso, cada um deles
  // gasta duas linhas dizendo "total internacoes covid" logo abaixo do título
  // que já dizia a mesma coisa.
  const compacto = widget.format === "indicador" && widget.display?.compact;
  const escala = widget.display?.scale ?? 1;

  return (
    <article
      data-bloco={widget.id}
      className={cn(
        "group relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface",
        "transition-[box-shadow,border-color,opacity] duration-150",
        emResize && "border-accent/50 shadow-lg",
        emMovimento && "scale-[1.02] cursor-grabbing border-accent/60 opacity-90 shadow-2xl",
      )}
    >
      {(emMovimento || emResize) && (
        <span className="pointer-events-none absolute bottom-2 right-5 z-20 rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-white shadow-sm [font-variant-numeric:tabular-nums]">
          {celula.w} × {celula.h}
        </span>
      )}

      <header className="flex shrink-0 items-start gap-2 px-3.5 pb-1.5 pt-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12.5px] font-medium leading-snug text-ink">{widget.title}</h3>
          {(dados?.dispensados?.length ?? 0) > 0 && (
            <p className="mt-1 text-[10.5px] text-caution">
              dispensa{" "}
              {dados!.dispensados
                .map((id) => filtros.find((f) => f.id === id)?.label ?? id)
                .join(", ")}
            </p>
          )}
          {widget.legacy && (
            <button
              onClick={onRecriar}
              className="mt-1 inline-flex items-center gap-1 rounded border border-caution/30 bg-caution-soft px-1.5 py-px text-[10.5px] text-caution transition-colors duration-150 hover:border-caution"
              title="Criado antes dos filtros configuráveis: não responde a nenhum. Clique para reconstruir a partir da pergunta original."
            >
              <RefreshCw aria-hidden className="h-3 w-3" />
              não responde aos filtros — recriar
            </button>
          )}
        </div>

        {/* A lupa fica SEMPRE visível, ao contrário dos outros controles: ela
            não é uma ação, é um estado — quantos filtros este widget dispensa. */}
        {!widget.legacy && (
          <LupaDeFiltros
            filtros={filtros}
            excluidos={widget.excluded}
            onAlternar={onAlternarFiltro}
          />
        )}

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          {/* Vale para todo widget: a aparência reetiqueta qual coluna vai
              para qual eixo sem tocar no SQL, e a aba de dados só aparece para
              quem nasceu do menu e guardou as escolhas. */}
          {!widget.legacy && (
            <EditorDeWidget
              widget={widget}
              resultado={res ?? null}
              catalogo={catalogo}
              onRefazer={onRefazer}
              onAparencia={onAparencia}
              onExibicao={onExibicao}
            />
          )}
          <button
            onPointerDown={(e) => comecar(widget.id, "mover", e)}
            onKeyDown={(e) => {
              const d =
                e.key === "ArrowLeft" ? { x: -1 }
                : e.key === "ArrowRight" ? { x: 1 }
                : e.key === "ArrowUp" ? { y: -1 }
                : e.key === "ArrowDown" ? { y: 1 }
                : null;
              if (!d) return;
              e.preventDefault();
              porTeclado(widget.id, d);
            }}
            aria-label="Mover o widget: arraste, ou use as setas"
            className="cursor-grab touch-none rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-ink active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onRemover}
            aria-label="Remover do painel"
            className="rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-critical"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5",
          compacto ? "pb-2.5" : "pb-2",
        )}
      >
        {dados?.error ? (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-[11.5px] leading-snug text-ink">
            {dados.error}
          </p>
        ) : carregando && !res ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin text-ink-subtle" />
          </div>
        ) : !res ? null : widget.format === "indicador" ? (
          <div
            className={cn(
              "flex flex-1 flex-col justify-center",
              compacto ? "py-0" : "py-1",
              carregando && "opacity-50",
            )}
          >
            <span
              className="font-semibold leading-none tracking-tight text-ink [font-variant-numeric:tabular-nums]"
              style={{ fontSize: `${escala * 30}px` }}
            >
              {typeof res.rows[0]?.[0] === "number"
                ? nf.format(res.rows[0][0] as number)
                : String(res.rows[0]?.[0] ?? "—")}
            </span>
            {/* O rótulo da coluna repete o título na maioria dos indicadores —
                "total internacoes covid" sob "Total de internações por
                COVID-19". No compacto ele sai. */}
            {!compacto && (
              <span className="mt-1 text-[11px] text-ink-subtle">
                {res.columns[0]?.replace(/_/g, " ")}
              </span>
            )}
          </div>
        ) : widget.chart ? (
          <div className={cn("min-h-[170px] flex-1", carregando && "opacity-50")}>
            <ResultChart spec={widget.chart} result={res} preencher />
          </div>
        ) : (
          <p className="py-3 text-[11.5px] text-ink-subtle">
            Este widget não declarou um gráfico. {res.nRows} linha(s).
          </p>
        )}
      </div>

      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className={cn(
          "flex shrink-0 items-center gap-1 px-3.5 pb-2 pt-0.5 text-[11px] text-ink-subtle transition-colors duration-150 hover:text-accent",
          // No compacto o rodapé só aparece ao passar o ponteiro: ele é a
          // terceira linha do cartão, e é justamente a que se quer devolver.
          compacto && "absolute bottom-0 left-0 opacity-0 focus:opacity-100 group-hover:opacity-100",
        )}
      >
        <ChevronDown
          aria-hidden
          className={cn("h-3 w-3 transition-transform duration-150", aberto && "rotate-180")}
        />
        {aberto ? "menos" : "detalhe"}
      </button>

      {aberto && (
        <div className="shrink-0 space-y-2 border-t border-line px-3.5 py-2.5">
          <p className="text-[11px] leading-relaxed text-ink-muted">
            <span className="font-medium">Pedido:</span> {widget.question}
          </p>
          {widget.assumptions.length > 0 && (
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              <span className="font-medium">Suposições:</span> {widget.assumptions.join(" · ")}
            </p>
          )}
          {/* Com os `?` à mostra: é o que explica por que o widget responde a
              uns filtros e não a outros. */}
          <SqlBlock sql={widget.sql} />
        </div>
      )}

      {/* Bordas para redimensionar, iguais às do tema. */}
      <span
        onPointerDown={(e) => comecar(widget.id, "direita", e)}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize touch-none opacity-0 transition-opacity duration-150 hover:opacity-100 group-hover:opacity-60"
        style={{ background: "linear-gradient(to right, transparent, var(--accent))" }}
        aria-hidden
      />
      <span
        onPointerDown={(e) => comecar(widget.id, "baixo", e)}
        className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize touch-none opacity-0 transition-opacity duration-150 hover:opacity-100 group-hover:opacity-60"
        style={{ background: "linear-gradient(to bottom, transparent, var(--accent))" }}
        aria-hidden
      />
      <button
        onPointerDown={(e) => comecar(widget.id, "quina", e)}
        onKeyDown={(e) => {
          const d: Partial<Celula> | null =
            e.key === "ArrowRight" ? { w: 1 }
            : e.key === "ArrowLeft" ? { w: -1 }
            : e.key === "ArrowDown" ? { h: 1 }
            : e.key === "ArrowUp" ? { h: -1 }
            : null;
          if (!d) return;
          e.preventDefault();
          porTeclado(widget.id, d);
        }}
        aria-label="Redimensionar o widget: arraste a quina, ou use as setas"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none rounded-tl-md opacity-0 transition-opacity duration-150 focus:opacity-100 group-hover:opacity-100"
      >
        <svg viewBox="0 0 10 10" className="h-full w-full text-ink-subtle" aria-hidden>
          <path d="M9 3 L3 9 M9 6.5 L6.5 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>
    </article>
  );
}
