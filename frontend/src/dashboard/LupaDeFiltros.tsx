import { Check, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PanelFilter } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Flutuante } from "./controles";

interface Props {
  filtros: PanelFilter[];
  /** Os que ESTE widget dispensa. Vazio — o padrão — é "obedece a todos". */
  excluidos: string[];
  onAlternar: (filtroId: string) => void;
}

/**
 * A lupa: quais filtros do painel valem NESTE widget.
 *
 * Existe porque o padrão certo e a exceção necessária brigam. O padrão é o
 * filtro valer para a tela inteira — é o que se espera de um painel, e é o que
 * torna um filtro útil. Mas nem todo recorte faz sentido em todo lugar: num
 * painel com "óbitos por sexo" ao lado de "total geral", filtrar o primeiro por
 * sexo o reduz a uma barra só.
 *
 * A lupa resolve sem inverter o padrão: tudo nasce ligado, e desligar é um ato
 * explícito, num lugar onde a pessoa vê o efeito. O selo no botão diz quantos
 * estão desligados, para a exceção não virar mistério três dias depois.
 */
export function LupaDeFiltros({ filtros, excluidos, onAlternar }: Props) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    // O painel vive no `body` por causa do portal: "clicou fora" olha as duas
    // caixas. Sem o portal ele saía cortado pelo `overflow-hidden` do cartão.
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !painel.current?.contains(alvo)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  if (filtros.length === 0) return null;
  const desligados = filtros.filter((f) => excluidos.includes(f.id)).length;

  return (
    <div ref={caixa} className="relative">
      <button
        ref={botao}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label={`Filtros deste widget: ${filtros.length - desligados} de ${filtros.length} ligados`}
        title="Quais filtros do painel valem neste widget"
        className={cn(
          "flex items-center gap-0.5 rounded p-1 transition-colors duration-150",
          desligados > 0 ? "text-caution" : "text-ink-subtle hover:text-ink",
        )}
      >
        <Search aria-hidden className="h-3.5 w-3.5" />
        {desligados > 0 && (
          <span className="text-[9.5px] font-semibold leading-none">−{desligados}</span>
        )}
      </button>

      {aberto && (
        <Flutuante ancora={botao} largura={224}>
          <div
            ref={painel}
            className="max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-2xl"
          >
          <p className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-ink-subtle">
            Filtros neste widget
          </p>
          <ul className="space-y-0.5">
            {filtros.map((f) => {
              const ligado = !excluidos.includes(f.id);
              return (
                <li key={f.id}>
                  <button
                    onClick={() => onAlternar(f.id)}
                    aria-pressed={ligado}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] transition-colors duration-150 hover:bg-raised"
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        ligado ? "border-accent bg-accent text-white" : "border-line",
                      )}
                    >
                      {ligado && <Check aria-hidden className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", ligado ? "text-ink" : "text-ink-subtle")}>
                      {f.label}
                    </span>
                    {/* Só o filtro ATIVO muda o número. Um filtro ligado mas sem
                        recorte não explica nada, e marcá-lo como se explicasse
                        mandaria a pessoa procurar efeito onde não há. */}
                    {f.active && (
                      <span className="shrink-0 text-[9.5px] text-accent">recortando</span>
                    )}
                  </button>
                </li>
              );
            })}
            </ul>
          </div>
        </Flutuante>
      )}
    </div>
  );
}
