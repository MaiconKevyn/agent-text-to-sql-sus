import { FlaskConical } from "lucide-react";
import { sugereInvestigacao } from "@/lib/investigable";

interface Props {
  question: string;
  onStart: (pergunta: string) => void;
}

/**
 * Oferece o modo investigação — nunca o dispara sozinho.
 *
 * Uma investigação custa 7-9 chamadas ao modelo e leva minutos. Transformar
 * toda pergunta complexa numa investigação automática gastaria o orçamento do
 * usuário sem ele pedir. O chip só existe quando a heurística acha que vale.
 */
export function InvestigateChip({ question, onStart }: Props) {
  const { vale, motivo } = sugereInvestigacao(question);
  if (!vale) return null;

  return (
    <button
      onClick={() => onStart(question)}
      className={
        "group flex w-full items-center gap-2.5 rounded-xl border border-accent/25 " +
        "bg-accent-soft px-3.5 py-2.5 text-left transition-colors duration-150 " +
        "hover:border-accent/45"
      }
    >
      <FlaskConical aria-hidden className="h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-ink">
          Investigar a fundo
        </span>
        <span className="block text-[11.5px] leading-snug text-ink-muted">
          Várias consultas e um relatório — {motivo}. Leva alguns minutos.
        </span>
      </span>
    </button>
  );
}
