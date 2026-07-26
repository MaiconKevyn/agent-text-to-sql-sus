import { Database, FileText, Globe, PenLine } from "lucide-react";
import type { Provenance } from "@/lib/types";

const SELOS: Record<Provenance, { rotulo: string; icone: typeof Database; tom: string }> = {
  banco: { rotulo: "do banco", icone: Database, tom: "border-line bg-raised text-ink-muted" },
  web: { rotulo: "da web", icone: Globe, tom: "border-caution/30 bg-caution-soft text-caution" },
  arquivo: { rotulo: "de arquivo", icone: FileText, tom: "border-caution/30 bg-caution-soft text-caution" },
  usuario: { rotulo: "anotação", icone: PenLine, tom: "border-line bg-raised text-ink-subtle" },
};

/**
 * De onde veio o conteúdo do bloco.
 *
 * Não é decoração. Um relatório mistura número do DuckDB com citação da
 * literatura, e o que separa isso de desinformação é o leitor saber, sem
 * esforço, qual é qual. Por isso a origem externa é âmbar e a do banco é
 * neutra: a atenção vai para o que precisa ser conferido.
 */
export function SourceBadge({ provenance }: { provenance: Provenance }) {
  const { rotulo, icone: Icone, tom } = SELOS[provenance] ?? SELOS.usuario;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-5 ${tom}`}
    >
      <Icone aria-hidden className="h-3 w-3" />
      {rotulo}
    </span>
  );
}
