import { ArrowUpRight, Activity } from "lucide-react";
import { SUGGESTED_QUESTIONS } from "@/mocks/api";
import { nf } from "@/lib/utils";

interface EmptyStateProps {
  onPick: (q: string) => void;
}

/**
 * A entrada escalonada aqui é feita em CSS, não em JavaScript. Este é o
 * conteúdo da primeira pintura: se a animação não rodasse — aba em segundo
 * plano, rAF suspenso — um `initial: opacity 0` deixaria a tela em branco.
 * Com `animation-fill-mode: both` o estado final é garantido de qualquer forma.
 */
export function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-1 py-10 text-center sm:py-16">
      <span className="flex h-11 w-11 animate-fade-up items-center justify-center rounded-xl border border-line bg-surface shadow-raised">
        <Activity aria-hidden className="h-5 w-5 text-accent" />
      </span>

      <h2
        className="mt-4 animate-fade-up text-balance text-xl font-semibold tracking-tight text-ink sm:text-2xl"
        style={{ animationDelay: "40ms" }}
      >
        Pergunte sobre as internações do SUS
      </h2>

      <p
        className="mt-2 max-w-md animate-fade-up text-pretty text-[14px] leading-relaxed text-ink-muted"
        style={{ animationDelay: "80ms" }}
      >
        {nf.format(144386772)} internações hospitalares registradas entre agosto de 2007 e
        dezembro de 2023. Escreva em português — a consulta SQL é gerada e executada para você.
      </p>

      <ul className="mt-8 grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.map((s, i) => (
          <li
            key={s.text}
            className="animate-fade-up"
            style={{ animationDelay: `${120 + i * 45}ms` }}
          >
            <button
              type="button"
              onClick={() => onPick(s.text)}
              className="group flex h-full w-full flex-col gap-1.5 rounded-xl border border-line bg-surface p-3.5 text-left shadow-subtle transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-raised"
            >
              <span className="flex items-start gap-2">
                <span className="flex-1 text-[13.5px] font-medium leading-snug text-ink">
                  {s.text}
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle transition-colors duration-150 group-hover:text-accent"
                />
              </span>
              <span className="text-[11px] text-ink-subtle">{s.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
