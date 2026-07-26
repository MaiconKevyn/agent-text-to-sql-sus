import { Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PanelFilter } from "@/lib/types";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("pt-BR");

interface Props {
  filtro: PanelFilter;
  onSelecionar: (selecao: (string | number)[]) => void;
  onRemover: () => void;
}

/**
 * Um filtro do painel, desenhado conforme o tipo que foi declarado.
 *
 * As opções vêm do BANCO, com a contagem de cada uma. Isso não é enfeite: numa
 * base do SUS, `SEXO` tem 1 e 3, e um controle com "Masculino/Feminino" escrito
 * à mão esconderia que o 2 não existe. A contagem ao lado também diz quando uma
 * opção é resíduo — 4 mil linhas contra 85 milhões é ruído, não categoria.
 *
 * Tudo marcado é o mesmo que nada marcado: o filtro fica inativo e não entra na
 * consulta. É o que evita o truque de vincular um curinga, que na versão
 * anterior deixava widgets permanentemente vazios sem nunca dar erro.
 */
export function ControleDeFiltro({ filtro, onSelecionar, onRemover }: Props) {
  const [faixa, setFaixa] = useState<[number, number]>([
    Number(filtro.selection[0] ?? filtro.min ?? 0),
    Number(filtro.selection[1] ?? filtro.max ?? 0),
  ]);
  useEffect(() => {
    if (filtro.kind !== "faixa") return;
    setFaixa([
      Number(filtro.selection[0] ?? filtro.min ?? 0),
      Number(filtro.selection[1] ?? filtro.max ?? 0),
    ]);
  }, [filtro.selection, filtro.kind, filtro.min, filtro.max]);

  const marcado = (v: string | number) => filtro.selection.includes(v);

  function alternar(v: string | number) {
    if (filtro.kind === "escolha") return onSelecionar([v]);
    const nova = marcado(v)
      ? filtro.selection.filter((x) => x !== v)
      : [...filtro.selection, v];
    // Desmarcar tudo é o mesmo que marcar tudo — as duas coisas significam "sem
    // recorte" —, e um painel vazio por desmarcar seria um beco sem saída.
    onSelecionar(nova.length ? nova : filtro.options.map((o) => o.value));
  }

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        filtro.active ? "border-accent/40 bg-accent-soft/40" : "border-line bg-canvas",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          {filtro.label}
        </span>
        {filtro.active && (
          <span className="rounded bg-accent px-1 py-px text-[9.5px] font-semibold text-white">
            ativo
          </span>
        )}
        {filtro.note && (
          <span title={filtro.note} className="cursor-help text-ink-subtle">
            <Info aria-hidden className="h-3 w-3" />
          </span>
        )}
        <button
          onClick={onRemover}
          aria-label={`Remover o filtro ${filtro.label}`}
          className="ml-auto rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-critical"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      </div>

      {filtro.kind === "faixa" ? (
        <div>
          <div className="mb-1 text-[12px] font-medium text-ink [font-variant-numeric:tabular-nums]">
            {faixa[0]} – {faixa[1]}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={filtro.min ?? 0}
              max={filtro.max ?? 100}
              value={faixa[0]}
              onChange={(e) => setFaixa([Math.min(Number(e.target.value), faixa[1]), faixa[1]])}
              onPointerUp={() => onSelecionar(faixa)}
              onKeyUp={() => onSelecionar(faixa)}
              aria-label={`${filtro.label}: mínimo`}
              className="h-1 w-24 cursor-pointer accent-[hsl(var(--accent))]"
            />
            <input
              type="range"
              min={filtro.min ?? 0}
              max={filtro.max ?? 100}
              value={faixa[1]}
              onChange={(e) => setFaixa([faixa[0], Math.max(Number(e.target.value), faixa[0])])}
              onPointerUp={() => onSelecionar(faixa)}
              onKeyUp={() => onSelecionar(faixa)}
              aria-label={`${filtro.label}: máximo`}
              className="h-1 w-24 cursor-pointer accent-[hsl(var(--accent))]"
            />
          </div>
        </div>
      ) : (
        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {filtro.options.map((o) => (
            <button
              key={String(o.value)}
              onClick={() => alternar(o.value)}
              aria-pressed={marcado(o.value)}
              title={o.count ? `${nf.format(o.count)} internações` : undefined}
              className={cn(
                "flex items-baseline gap-1.5 rounded border px-1.5 py-0.5 text-[11px] transition-colors duration-150",
                marcado(o.value)
                  ? "border-accent bg-accent text-white"
                  : "border-line text-ink-muted hover:border-accent/40 hover:text-ink",
              )}
            >
              <span className="font-medium">{o.label}</span>
              {/* Separado por um vão de verdade: colados, o valor "3" e a
                  contagem "85.4M" viravam "385.4M" — um número que não existe. */}
              {o.count > 0 && (
                <span className={cn("text-[10px]", marcado(o.value) ? "opacity-75" : "text-ink-subtle")}>
                  {o.count >= 1e6 ? `${(o.count / 1e6).toFixed(1)}M` : nf.format(o.count)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
