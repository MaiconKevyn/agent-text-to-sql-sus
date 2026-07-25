import { AlertCircle, Check, Minus } from "lucide-react";
import type { AgentStep } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

interface ThinkingStepsProps {
  steps: AgentStep[];
  /** Colapsa para uma linha quando a resposta terminou. */
  compact?: boolean;
}

function Marcador({ state }: { state: AgentStep["state"] }) {
  if (state === "concluido")
    return <Check aria-hidden className="h-3 w-3 text-positive" strokeWidth={3} />;
  if (state === "falhou")
    return <AlertCircle aria-hidden className="h-3 w-3 text-critical" strokeWidth={2.5} />;
  if (state === "pulado")
    return <Minus aria-hidden className="h-3 w-3 text-ink-subtle" strokeWidth={3} />;
  if (state === "ativo")
    return (
      <span className="relative flex h-3 w-3 items-center justify-center">
        <span className="absolute h-3 w-3 animate-ping rounded-full bg-accent/40" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
    );
  return <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />;
}

export function ThinkingSteps({ steps, compact = false }: ThinkingStepsProps) {
  const ativo = steps.find((s) => s.state === "ativo");
  const feitos = steps.filter((s) => s.state === "concluido" || s.state === "pulado").length;

  if (compact) {
    const falhou = steps.some((s) => s.state === "falhou");
    return (
      <p className="text-[11px] text-ink-subtle">
        {falhou ? "Interrompido" : `${feitos} etapas concluídas`}
      </p>
    );
  }

  return (
    <ol className="space-y-1.5" aria-label="Progresso do agente">
        {steps.map((s, i) => {
          const inativo = s.state === "pendente";
          return (
            <li
              key={s.id}
              className={cn(
                "flex animate-fade-up items-start gap-2.5 transition-opacity duration-200 ease-out",
                inativo && "opacity-45",
              )}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <Marcador state={s.state} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "text-[13px] leading-5",
                    s.state === "ativo" && "font-medium text-ink",
                    s.state === "concluido" && "text-ink-muted",
                    s.state === "falhou" && "font-medium text-critical",
                    (s.state === "pendente" || s.state === "pulado") && "text-ink-subtle",
                  )}
                >
                  {s.label}
                  {s.state === "pulado" && " — não foi necessário"}
                </span>
                {s.detail && s.state !== "pendente" && (
                  <span className="block truncate text-[11px] leading-4 text-ink-subtle">
                    {s.detail}
                  </span>
                )}
              </span>
              {s.elapsed !== undefined && s.state === "concluido" && (
                <span className="shrink-0 pt-0.5 text-[10px] tabular-nums text-ink-subtle">
                  {formatDuration(s.elapsed)}
                </span>
              )}
            </li>
          );
        })}
      <span className="sr-only" aria-live="polite">
        {ativo ? ativo.label : ""}
      </span>
    </ol>
  );
}
