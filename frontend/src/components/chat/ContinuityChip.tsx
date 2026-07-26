import { CornerDownRight, Sparkles } from "lucide-react";
import type { Continuity } from "@/lib/types";

interface Props {
  continuity: Continuity;
  /** Refaz a pergunta pedindo o comportamento oposto. */
  onCorrect: (instrucao: string) => void;
}

/**
 * Mostra o que o agente fez com a pergunta anterior — e deixa corrigir.
 *
 * A decisão sempre existiu; o que faltava era vê-la. Sem este chip, uma
 * continuação que perdeu o filtro devolve um número plausível sobre outro
 * assunto, e nada na tela sinaliza isso.
 */
export function ContinuityChip({ continuity, onCorrect }: Props) {
  const seguiu = continuity.kind === "acompanhamento";
  const { kept, dropped } = continuity;

  // Um "assunto novo" sem nada descartado é o caso trivial da primeira
  // pergunta de um tema: não há o que conferir, e o chip só faria ruído.
  if (!seguiu && dropped.length === 0) return null;

  return (
    <div
      className={
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 " +
        (seguiu
          ? "border-line bg-raised"
          : "border-caution/25 bg-caution-soft")
      }
    >
      {seguiu ? (
        <CornerDownRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      ) : (
        <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-caution" />
      )}

      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed">
        {seguiu ? (
          <>
            <span className="font-medium text-ink">Continuando a pergunta anterior</span>
            {kept.length > 0 && (
              <span className="text-ink-muted"> — manteve {kept.join(" · ")}</span>
            )}
          </>
        ) : (
          <span className="font-medium text-ink">Tratado como assunto novo</span>
        )}

        {dropped.length > 0 && (
          <div className="mt-0.5 text-ink-muted">
            Não manteve: {dropped.join(" · ")}
          </div>
        )}
      </div>

      <button
        onClick={() =>
          onCorrect(
            seguiu
              ? " Ignore a pergunta anterior: comece do zero, sem herdar nenhum filtro."
              : ` Continue a pergunta anterior mantendo os mesmos recortes${
                  dropped.length ? ` (${dropped.join("; ")})` : ""
                }.`,
          )
        }
        className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium text-accent transition-colors duration-150 hover:bg-accent-soft"
      >
        {seguiu ? "começar do zero" : "manter os filtros"}
      </button>
    </div>
  );
}
