import { CornerDownRight } from "lucide-react";

interface FollowUpChipsProps {
  questions: string[];
  disabled?: boolean;
  onPick: (q: string) => void;
}

export function FollowUpChips({ questions, disabled, onPick }: FollowUpChipsProps) {
  if (questions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-10">
      <CornerDownRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      {questions.map((q, i) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          style={{ animationDelay: `${i * 50}ms` }}
          className="animate-fade-up rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-muted shadow-subtle transition-[border-color,color,transform] duration-150 ease-out hover:border-accent/40 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
