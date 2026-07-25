import { ChevronRight, Database } from "lucide-react";
import { useState } from "react";
import { Collapsible } from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ui/copy-button";
import { SqlCode } from "@/components/ui/sql-code";

interface SqlBlockProps {
  sql: string;
}

/** Accordion recolhido por padrão: o SQL é para quem quiser conferir. */
export function SqlBlock({ sql }: SqlBlockProps) {
  const [aberto, setAberto] = useState(false);
  const linhas = sql.trim().split("\n").length;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="flex flex-1 items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-raised"
        >
          <ChevronRight
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-out"
            style={{ transform: aberto ? "rotate(90deg)" : undefined }}
          />
          <Database aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
          <span className="text-[13px] font-medium text-ink-muted">Consulta SQL gerada</span>
          <span className="text-[11px] text-ink-subtle">
            {linhas} {linhas === 1 ? "linha" : "linhas"}
          </span>
        </button>
        <CopyButton value={sql} label="Copiar SQL" />
      </div>

      <Collapsible open={aberto}>
        <div className="border-t border-line bg-raised/40">
          <SqlCode sql={sql} />
        </div>
      </Collapsible>
    </div>
  );
}
