import { Check, CircleDashed, Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { BlockRole, BlockWeight } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * O que o achado faz no argumento: sustenta, contradiz ou contextualiza.
 *
 * Existe porque um mosaico de dez cards iguais esconde exatamente o que uma
 * investigação mais precisa mostrar — a evidência que vai contra. Sem um selo,
 * a contradição fica com o mesmo peso visual do número que confirma o que já se
 * pensava, e a única forma de achá-la é ler os dez.
 *
 * O PESO é a outra metade: material significa que a conclusão cai junto se o
 * achado cair. É o que dá sentido a "esta resposta se apoia em dois achados" —
 * sem a distinção, apoiar-se em dez achados secundários pareceria mais forte
 * que apoiar-se em um material, e é o contrário.
 */

export const PAPEIS: { id: Exclude<BlockRole, "">; rotulo: string; dica: string }[] = [
  { id: "sustenta", rotulo: "sustenta", dica: "A evidência empurra a favor da hipótese" },
  { id: "contradiz", rotulo: "contradiz", dica: "A evidência vai contra — e é isso que precisa aparecer" },
  { id: "contextualiza", rotulo: "contextualiza", dica: "Não decide nada, mas sem ela o resto se lê errado" },
];

const CLASSE: Record<Exclude<BlockRole, "">, string> = {
  sustenta: "border-positive/40 bg-positive-soft text-positive",
  contradiz: "border-caution/50 bg-caution-soft text-caution",
  contextualiza: "border-line bg-raised text-ink-muted",
};

/** O selo, para o cabeçalho do card. Não classificado também é um estado. */
export function SeloDePapel({
  papel,
  peso,
  compacto = false,
}: {
  papel: BlockRole;
  peso: BlockWeight;
  compacto?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={cn(
          "rounded border px-1 py-px text-[9.5px] uppercase tracking-wide",
          papel ? CLASSE[papel] : "border-dashed border-line text-ink-subtle",
        )}
        title={papel ? PAPEIS.find((p) => p.id === papel)?.dica : "Ninguém classificou este achado"}
      >
        {papel || "sem papel"}
      </span>
      {/* Só o material aparece: marcar "secundário" em oito de dez cards seria
          ruído dizendo o que o silêncio já diz. */}
      {peso === "material" && (
        <span
          className="rounded border border-ink-subtle px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink"
          title="Se este achado cair, a conclusão que se apoia nele cai junto"
        >
          {compacto ? "mat." : "material"}
        </span>
      )}
    </span>
  );
}

interface Props {
  papel: BlockRole;
  peso: BlockWeight;
  porque: string;
  /** Devolve quando gravou. */
  onMudar: (patch: { role?: BlockRole; weight?: BlockWeight; why?: string }) => Promise<void>;
}

/** O editor, para o detalhe do card. */
export function PapelDoAchado({ papel, peso, porque, onMudar }: Props) {
  const [texto, setTexto] = useState(porque);
  const [salvando, setSalvando] = useState(false);

  async function trocar(patch: Parameters<typeof onMudar>[0]) {
    setSalvando(true);
    await onMudar(patch);
    setSalvando(false);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
        No argumento deste tema
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {PAPEIS.map((p) => (
          <button
            key={p.id}
            onClick={() => void trocar({ role: papel === p.id ? "" : p.id })}
            aria-pressed={papel === p.id}
            title={p.dica}
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150",
              papel === p.id ? CLASSE[p.id] : "border-line text-ink-muted hover:text-ink",
            )}
          >
            {papel === p.id ? (
              <Check aria-hidden className="mr-1 inline h-2.5 w-2.5" strokeWidth={3} />
            ) : (
              <CircleDashed aria-hidden className="mr-1 inline h-2.5 w-2.5" />
            )}
            {p.rotulo}
          </button>
        ))}
        <button
          onClick={() => void trocar({ weight: peso === "material" ? "secundario" : "material" })}
          aria-pressed={peso === "material"}
          title="Material: se este achado cair, a conclusão que se apoia nele cai junto"
          className={cn(
            "ml-auto rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150",
            peso === "material"
              ? "border-ink-subtle font-semibold text-ink"
              : "border-line text-ink-muted hover:text-ink",
          )}
        >
          {peso === "material" ? (
            <Minus aria-hidden className="mr-1 inline h-2.5 w-2.5" />
          ) : (
            <Plus aria-hidden className="mr-1 inline h-2.5 w-2.5" />
          )}
          material
        </button>
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => texto !== porque && void trocar({ why: texto })}
        rows={2}
        placeholder="Por que importa — a frase que explica o que este achado prova ou derruba"
        aria-label="Por que este achado importa"
        className="w-full resize-none rounded-lg border border-line bg-canvas px-2 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none transition-colors duration-150 focus:border-accent placeholder:text-ink-subtle"
      />
      {salvando && <p className="text-[10px] text-ink-subtle">salvando…</p>}
    </div>
  );
}
