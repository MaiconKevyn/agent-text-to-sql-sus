import { RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { Feedback } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MessageActionsProps {
  text: string;
  feedback?: Feedback;
  disabled?: boolean;
  onRegenerate: () => void;
  onFeedback: (v: Feedback) => void;
}

export function MessageActions({
  text,
  feedback,
  disabled,
  onRegenerate,
  onFeedback,
}: MessageActionsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        // Aparecem no hover no desktop; sempre visíveis no toque e no teclado.
        "opacity-100 transition-opacity duration-150 ease-out",
        "md:opacity-0 md:group-hover/msg:opacity-100 md:focus-within:opacity-100",
      )}
    >
      <CopyButton value={text} label="Copiar resposta" />
      <Button
        size="icon-sm"
        aria-label="Refazer resposta"
        title="Refazer resposta"
        disabled={disabled}
        onClick={onRegenerate}
      >
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
      </Button>
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <Button
        size="icon-sm"
        aria-label="Resposta útil"
        aria-pressed={feedback === "util"}
        title="Resposta útil"
        className={cn(feedback === "util" && "text-positive")}
        onClick={() => onFeedback("util")}
      >
        <ThumbsUp aria-hidden className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-sm"
        aria-label="Resposta não útil"
        aria-pressed={feedback === "nao-util"}
        title="Resposta não útil"
        className={cn(feedback === "nao-util" && "text-critical")}
        onClick={() => onFeedback("nao-util")}
      >
        <ThumbsDown aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
