import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardFilters } from "@/lib/types";
import { cn } from "@/lib/utils";

const ANO_MIN = 2007;
const ANO_MAX = 2024;

/** As 27 siglas. Lista fechada porque digitar UF errada devolve painel vazio. */
const UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");

/**
 * Capítulos da CID-10 que fazem sentido como filtro rápido. Prefixo, porque é
 * assim que a CID se organiza e é o recorte que o dicionário de dados ensina.
 * Quem quer `C50` digita — a lista é atalho, não limite.
 */
const CAPITULOS = [
  { valor: "", rotulo: "Todos os diagnósticos" },
  { valor: "A", rotulo: "A — infecciosas e parasitárias" },
  { valor: "C", rotulo: "C — neoplasias malignas" },
  { valor: "E", rotulo: "E — endócrinas e metabólicas" },
  { valor: "I", rotulo: "I — aparelho circulatório" },
  { valor: "J", rotulo: "J — aparelho respiratório" },
  { valor: "O", rotulo: "O — gravidez, parto e puerpério" },
  { valor: "S", rotulo: "S — lesões e traumatismos" },
];

interface Props {
  filtros: DashboardFilters;
  onMudar: (f: Partial<DashboardFilters>) => void;
  /** Quantos widgets não respondem a cada filtro, para avisar em cima. */
  ignoram: Record<string, number>;
  total: number;
  ocupado?: boolean;
}

const PADRAO: DashboardFilters = { yearFrom: ANO_MIN, yearTo: ANO_MAX, diagnosis: "", uf: "" };

/**
 * Os filtros do painel.
 *
 * Fechados de propósito: os três mapeiam para colunas de semântica conhecida.
 * Um campo livre convidaria "por hospital", que a base não tem, e devolveria
 * silêncio — a pior resposta possível para um filtro.
 *
 * O aviso de quantos widgets ignoram cada filtro fica AQUI, e não só no widget:
 * quem move a data precisa saber, antes de interpretar a tela, que dois dos
 * cinco gráficos não se mexeram porque não podem, e não porque o dado é plano.
 */
export function BarraDeFiltros({ filtros, onMudar, ignoram, total, ocupado }: Props) {
  // Estado local para o ano: o slider dispara a cada pixel, e cada mudança
  // recalcula tudo sobre 144 milhões de linhas. O commit vai no soltar.
  const [ini, setIni] = useState(filtros.yearFrom);
  const [fim, setFim] = useState(filtros.yearTo);
  useEffect(() => {
    setIni(filtros.yearFrom);
    setFim(filtros.yearTo);
  }, [filtros.yearFrom, filtros.yearTo]);

  const limpo =
    filtros.yearFrom === PADRAO.yearFrom &&
    filtros.yearTo === PADRAO.yearTo &&
    !filtros.diagnosis &&
    !filtros.uf;

  const aviso = (chave: string) =>
    ignoram[chave] > 0 ? (
      <span className="text-[10px] text-caution" title={`${ignoram[chave]} de ${total} widgets não usam este filtro`}>
        {ignoram[chave]}/{total} ignoram
      </span>
    ) : null;

  return (
    <section
      aria-label="Filtros do painel"
      className="mb-3 flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3"
    >
      <div className="min-w-[15rem] flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <label htmlFor="ano-ini" className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
            Período
          </label>
          <span className="text-[12px] font-medium text-ink [font-variant-numeric:tabular-nums]">
            {ini}–{fim}
          </span>
          {aviso("periodo")}
        </div>
        <div className="flex items-center gap-2">
          <input
            id="ano-ini"
            type="range"
            min={ANO_MIN}
            max={ANO_MAX}
            value={ini}
            onChange={(e) => setIni(Math.min(Number(e.target.value), fim))}
            onPointerUp={() => onMudar({ yearFrom: ini, yearTo: fim })}
            onKeyUp={() => onMudar({ yearFrom: ini, yearTo: fim })}
            aria-label="Ano inicial"
            className="h-1 flex-1 cursor-pointer accent-[hsl(var(--accent))]"
          />
          <input
            type="range"
            min={ANO_MIN}
            max={ANO_MAX}
            value={fim}
            onChange={(e) => setFim(Math.max(Number(e.target.value), ini))}
            onPointerUp={() => onMudar({ yearFrom: ini, yearTo: fim })}
            onKeyUp={() => onMudar({ yearFrom: ini, yearTo: fim })}
            aria-label="Ano final"
            className="h-1 flex-1 cursor-pointer accent-[hsl(var(--accent))]"
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline gap-2">
          <label htmlFor="diag" className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
            Diagnóstico
          </label>
          {aviso("diagnostico")}
        </div>
        <select
          id="diag"
          value={CAPITULOS.some((c) => c.valor === filtros.diagnosis) ? filtros.diagnosis : "outro"}
          onChange={(e) => onMudar({ diagnosis: e.target.value === "outro" ? filtros.diagnosis : e.target.value })}
          className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
        >
          {CAPITULOS.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
          {!CAPITULOS.some((c) => c.valor === filtros.diagnosis) && (
            <option value="outro">{filtros.diagnosis} (digitado)</option>
          )}
        </select>
      </div>

      <div>
        <div className="mb-1 flex items-baseline gap-2">
          <label htmlFor="uf" className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
            UF
          </label>
          {aviso("uf")}
        </div>
        <select
          id="uf"
          value={filtros.uf}
          onChange={(e) => onMudar({ uf: e.target.value })}
          className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
        >
          <option value="">Todas</option>
          {UFS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => onMudar(PADRAO)}
        disabled={limpo}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px]",
          "text-ink-muted transition-colors duration-150 hover:text-ink disabled:opacity-40",
        )}
      >
        <RotateCcw aria-hidden className={cn("h-3.5 w-3.5", ocupado && "animate-spin")} />
        Limpar
      </button>
    </section>
  );
}
