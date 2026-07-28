import { Check, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogForm, ChartKind, ChartSpec, QueryResult } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  spec: ChartSpec;
  /** O resultado atual: é dele que saem as colunas oferecidas nos eixos. */
  resultado: QueryResult | null;
  formas: CatalogForm[];
  /** Devolve a recusa, ou string vazia se deu certo. */
  onSalvar: (patch: Partial<ChartSpec>) => Promise<string>;
}

/**
 * O ajuste de um gráfico que já existe: forma, eixos, série e cores.
 *
 * A escolha de projeto que faz isto valer a pena é não tocar no SQL. Trocar o
 * eixo X é reetiquetar qual coluna do resultado vai para onde — nenhuma consulta
 * roda de novo, nada varre 144 milhões de linhas, e o ajuste vale igualmente
 * para os widgets que um modelo escreveu, que são a maioria do painel.
 *
 * As colunas oferecidas saem do RESULTADO, não de uma lista fixa. Um eixo que
 * aponta para uma coluna inexistente não dá erro: faz o gráfico desaparecer sem
 * dizer por quê. Oferecer só o que a consulta devolveu torna esse estado
 * inalcançável pelo menu, e o servidor confere de novo por via das dúvidas.
 */
export function AjusteDoGrafico({ spec, resultado, formas, onSalvar }: Props) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label="Ajustar o gráfico: forma, eixos e cores"
        title="Ajustar forma, eixos e cores"
        className="rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-ink"
      >
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
      </button>

      {aberto && (
        <Formulario
          spec={spec}
          resultado={resultado}
          formas={formas}
          onSalvar={onSalvar}
          onFechar={() => setAberto(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

const CAIXA =
  "w-full rounded-md border border-line bg-canvas px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent";

function Formulario({
  spec,
  resultado,
  formas,
  onSalvar,
  onFechar,
}: Props & { onFechar: () => void }) {
  const colunas = resultado?.columns ?? [];
  const [forma, setForma] = useState<ChartKind>(spec.kind);
  const [x, setX] = useState(spec.x);
  const [y, setY] = useState(spec.y);
  const [serie, setSerie] = useState(spec.series ?? "");
  const [cores, setCores] = useState<string[]>(spec.colors ?? []);
  const [rotulos, setRotulos] = useState(spec.showLabels ?? false);
  const [legenda, setLegenda] = useState(spec.showLegend ?? true);
  const [suave, setSuave] = useState(spec.smooth ?? true);
  const [area, setArea] = useState(spec.area ?? false);
  const [empilhar, setEmpilhar] = useState(spec.stack ?? false);
  const [recusa, setRecusa] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Quantas cores mostrar: uma por série de verdade. Sem coluna de série é uma
  // só — exceto na pizza, em que cada fatia é uma cor.
  const quantasCores = useMemo(() => {
    if (!resultado) return 1;
    const is = serie ? colunas.indexOf(serie) : -1;
    if (is >= 0) return Math.min(12, new Set(resultado.rows.map((r) => String(r[is]))).size);
    if (forma === "pizza") return Math.min(12, resultado.rows.length);
    return 1;
  }, [resultado, serie, colunas, forma]);

  const formaAtual = formas.find((f) => f.id === forma);

  async function salvar() {
    setSalvando(true);
    const erro = await onSalvar({
      kind: forma,
      x,
      y,
      series: serie,
      appearance: {
        colors: cores.some(Boolean) ? cores.slice(0, quantasCores) : null,
        showLabels: rotulos,
        showLegend: legenda,
        smooth: suave,
        area,
        stack: empilhar,
      },
    } as Partial<ChartSpec>);
    setSalvando(false);
    if (erro) setRecusa(erro);
    else onFechar();
  }

  return (
    <div className="absolute right-0 top-full z-40 mt-1 w-72 space-y-2.5 rounded-lg border border-line bg-surface p-2.5 shadow-xl">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          Ajustar gráfico
        </span>
        <button
          onClick={onFechar}
          aria-label="Fechar"
          className="rounded p-0.5 text-ink-subtle hover:text-ink"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {formas.map((f) => {
          const bloqueada = f.needsSeries && !serie;
          return (
            <button
              key={f.id}
              disabled={bloqueada}
              onClick={() => setForma(f.id)}
              aria-pressed={forma === f.id}
              title={bloqueada ? `${f.label} exige uma série` : f.label}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150",
                forma === f.id
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-muted hover:text-ink",
                bloqueada && "cursor-not-allowed opacity-35",
              )}
            >
              {f.label.replace(/ \(.*\)/, "")}
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-end gap-1.5">
          <label className="min-w-0 flex-1">
            {/* Os rótulos dizem o PAPEL de cada eixo, não só a letra: X é a
                categoria e Y é o valor. Sem isso, "inverter" parece deitar o
                gráfico — e o que faz é pôr texto no eixo do número, que desenha
                um gráfico em branco. */}
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
              X · categoria
            </span>
            <select value={x} onChange={(e) => setX(e.target.value)} className={CAIXA}>
              {colunas.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              setX(y);
              setY(x);
            }}
            title="Trocar as duas colunas de lugar. Para deitar as barras, use a forma 'Barras horizontais'."
            aria-label="Trocar as colunas dos eixos X e Y"
            className="mb-px shrink-0 rounded-md border border-line p-1 text-ink-subtle transition-colors duration-150 hover:border-accent/40 hover:text-accent"
          >
            <RotateCcw aria-hidden className="h-3 w-3" />
          </button>
          <label className="min-w-0 flex-1">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
              Y · valor
            </span>
            <select value={y} onChange={(e) => setY(e.target.value)} className={CAIXA}>
              {colunas.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
            Série
          </span>
          <select value={serie} onChange={(e) => setSerie(e.target.value)} className={CAIXA}>
            <option value="">— nenhuma —</option>
            {colunas
              .filter((c) => c !== x && c !== y)
              .map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {[
          { rot: "valores", v: rotulos, set: setRotulos, quando: true },
          { rot: "legenda", v: legenda, set: setLegenda, quando: !!serie || forma === "pizza" },
          { rot: "suavizar", v: suave, set: setSuave, quando: forma === "linha" },
          { rot: "área", v: area, set: setArea, quando: forma === "linha" },
          { rot: "empilhar", v: empilhar, set: setEmpilhar, quando: forma === "barra" && !!serie },
        ]
          .filter((o) => o.quando)
          .map((o) => (
            <button
              key={o.rot}
              onClick={() => o.set(!o.v)}
              aria-pressed={o.v}
              className={cn(
                "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150",
                o.v ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-muted",
              )}
            >
              <span
                className={cn(
                  "flex h-2.5 w-2.5 items-center justify-center rounded-[2px] border",
                  o.v ? "border-accent bg-accent text-white" : "border-line",
                )}
              >
                {o.v && <Check aria-hidden className="h-1.5 w-1.5" strokeWidth={5} />}
              </span>
              {o.rot}
            </button>
          ))}
      </div>

      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-subtle">
          Cores
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {Array.from({ length: quantasCores }).map((_, i) => (
            <input
              key={i}
              type="color"
              value={cores[i] ?? "#4a7fd4"}
              onChange={(e) =>
                setCores((c) => {
                  const n = [...c];
                  // As anteriores não podem ficar vazias: uma lista com buraco
                  // pintaria a série 2 com a cor da 1 no lugar da paleta.
                  for (let k = 0; k < i; k++) n[k] ??= "#4a7fd4";
                  n[i] = e.target.value;
                  return n;
                })
              }
              aria-label={`Cor da série ${i + 1}`}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          ))}
          {cores.some(Boolean) && (
            <button
              onClick={() => setCores([])}
              title="Voltar para a paleta do tema, que é validada para daltonismo e contraste"
              className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-subtle transition-colors duration-150 hover:text-ink"
            >
              usar a paleta
            </button>
          )}
        </div>
      </div>

      {recusa && (
        <p className="rounded bg-caution-soft px-2 py-1 text-[10.5px] leading-relaxed text-ink">
          {recusa}
        </p>
      )}

      <button
        onClick={salvar}
        disabled={salvando || (formaAtual?.needsSeries && !serie)}
        className="w-full rounded-md bg-accent px-2 py-1.5 text-[11.5px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
      >
        {salvando ? "Salvando…" : "Aplicar"}
      </button>
    </div>
  );
}
