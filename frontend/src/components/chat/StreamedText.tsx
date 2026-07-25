import { useState } from "react";
import { Button } from "@/components/ui/button";

const LIMITE = 900;

interface StreamedTextProps {
  text: string;
  streaming: boolean;
}

/**
 * Texto da resposta com cursor durante o streaming e corte em "ver mais"
 * quando fica longo demais — só depois que terminou de chegar.
 */
export function StreamedText({ text, streaming }: StreamedTextProps) {
  const [expandido, setExpandido] = useState(false);
  const longo = !streaming && text.length > LIMITE;
  const visivel = longo && !expandido ? text.slice(0, LIMITE).trimEnd() + "…" : text;

  return (
    <div>
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
        {visivel}
        {streaming && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-blink bg-accent"
          />
        )}
      </p>
      {longo && (
        <Button
          size="sm"
          variant="subtle"
          className="mt-2"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
        >
          {expandido ? "Ver menos" : "Ver mais"}
        </Button>
      )}
    </div>
  );
}
