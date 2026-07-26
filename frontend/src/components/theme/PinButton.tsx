import { Bookmark, Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Theme, ThemeBlock } from "@/lib/types";

interface Props {
  /** O bloco pronto para ser guardado — resultado, gráfico e definição juntos. */
  bloco: () => Partial<ThemeBlock>;
  temas: Theme[];
  ultimo: Theme | null;
  onPin: (bloco: Partial<ThemeBlock>, temaId?: string) => Promise<string>;
  onNovo: (titulo: string) => Promise<Theme>;
}

/**
 * Fixa uma resposta num tema de investigação.
 *
 * O clique direto vai para o último tema usado — sem isso, cada fixação exigiria
 * escolher um destino, e o gesto deixaria de valer o clique. A seta abre a
 * lista para mandar a outro lugar.
 */
export function PinButton({ bloco, temas, ultimo, onPin, onNovo }: Props) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  async function fixar(temaId?: string) {
    if (salvando) return;  // dois cliques rápidos gravariam o bloco duas vezes
    setSalvando(true);
    setAberto(false);
    try {
      await onPin(bloco(), temaId);
      setFeito(true);
      // Volta ao normal: o botão continua disponível para fixar noutro tema.
      setTimeout(() => setFeito(false), 2200);
    } finally {
      setSalvando(false);
    }
  }

  const rotulo = feito
    ? "fixado"
    : ultimo
      ? `fixar em ${ultimo.title}`
      : "fixar num tema";

  return (
    <div ref={caixa} className="relative inline-flex">
      <button
        onClick={() => void fixar()}
        disabled={salvando}
        title={rotulo}
        className={
          "flex items-center gap-1.5 rounded-l-lg border border-r-0 border-line px-2.5 py-1 " +
          "text-[11.5px] transition-colors duration-150 " +
          (feito
            ? "border-accent/40 bg-accent-soft text-accent"
            : "text-ink-muted hover:border-accent/40 hover:text-accent")
        }
      >
        {salvando ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : feito ? (
          <Check aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <Bookmark aria-hidden className="h-3.5 w-3.5" />
        )}
        <span className="max-w-[13rem] truncate">{rotulo}</span>
      </button>

      <button
        onClick={() => setAberto((v) => !v)}
        aria-label="Escolher o tema"
        aria-expanded={aberto}
        className="rounded-r-lg border border-line px-1.5 py-1 text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
      >
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>

      {aberto && (
        <div className="absolute bottom-full right-0 z-20 mb-1 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
          <ul className="max-h-56 overflow-y-auto">
            {temas.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => void fixar(t.id)}
                  className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-raised"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-subtle">{t.blockCount}</span>
                </button>
              </li>
            ))}
            {temas.length === 0 && (
              <li className="px-3 py-3 text-center text-[11.5px] text-ink-subtle">
                Nenhum tema ainda
              </li>
            )}
          </ul>
          <button
            onClick={async () => {
              const titulo = (bloco().question ?? "").slice(0, 60) || "Nova investigação";
              const t = await onNovo(titulo);
              await fixar(t.id);
            }}
            className="flex w-full items-center gap-1.5 border-t border-line px-3 py-2 text-[12px] text-accent transition-colors duration-150 hover:bg-accent-soft"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Criar um tema para isto
          </button>
        </div>
      )}
    </div>
  );
}
