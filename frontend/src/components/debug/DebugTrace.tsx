import { ChevronRight, Terminal } from "lucide-react";
import { useState } from "react";
import { Collapsible } from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ui/copy-button";
import { SqlCode } from "@/components/ui/sql-code";
import { STEP_LABELS, type TraceEntry } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

interface DebugTraceProps {
  entries: TraceEntry[];
}

function Conteudo({ entry }: { entry: TraceEntry }) {
  if (entry.format === "sql") return <SqlCode sql={entry.body} />;
  return (
    <pre
      className={cn(
        "scroll-thin max-h-80 overflow-auto px-4 py-3",
        "whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-muted",
      )}
    >
      {entry.body}
    </pre>
  );
}

/**
 * Trace completo do que aconteceu entre a pergunta e a resposta: contexto
 * montado, códigos vinculados, plano do modelo, SQL executado e instruções de
 * redação. Cada entrada abre individualmente.
 */
export function DebugTrace({ entries }: DebugTraceProps) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const alternar = (id: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <section
      aria-label="Trace de depuração"
      className="overflow-hidden rounded-xl border border-dashed border-accent/35 bg-accent-soft/40"
    >
      <header className="flex items-center gap-2 border-b border-dashed border-accent/25 px-3.5 py-2">
        <Terminal aria-hidden className="h-3.5 w-3.5 text-accent" />
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-accent">
          Trace do agente
        </h3>
        <span className="text-[11px] text-ink-subtle">
          {entries.length} {entries.length === 1 ? "evento" : "eventos"}
        </span>
        <button
          type="button"
          onClick={() =>
            setAbertos((s) => (s.size === entries.length ? new Set() : new Set(entries.map((e) => e.id))))
          }
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
        >
          {abertos.size === entries.length ? "Recolher tudo" : "Expandir tudo"}
        </button>
      </header>

      <ol className="divide-y divide-dashed divide-accent/20">
        {entries.map((e, i) => {
          const aberto = abertos.has(e.id);
          return (
            <li key={e.id}>
              <div className="flex items-center gap-2 pr-2">
                <button
                  type="button"
                  onClick={() => alternar(e.id)}
                  aria-expanded={aberto}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2 text-left transition-colors duration-150 ease-out hover:bg-surface/60"
                >
                  <ChevronRight
                    aria-hidden
                    className="h-3 w-3 shrink-0 text-ink-subtle transition-transform duration-200 ease-out"
                    style={{ transform: aberto ? "rotate(90deg)" : undefined }}
                  />
                  <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-subtle">
                    {i + 1}
                  </span>
                  <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-subtle">
                    {STEP_LABELS[e.step].split(" ")[0]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
                    {e.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-subtle">
                    {e.elapsed !== undefined
                      ? formatDuration(e.elapsed)
                      : `${e.body.length.toLocaleString("pt-BR")} ch`}
                  </span>
                </button>
                <CopyButton value={e.body} label={`Copiar ${e.title}`} />
              </div>

              <Collapsible open={aberto}>
                <div className="border-t border-dashed border-accent/20 bg-surface">
                  <Conteudo entry={e} />
                </div>
              </Collapsible>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
