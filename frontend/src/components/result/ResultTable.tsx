import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { QueryResult } from "@/lib/types";
import { compareValues, downloadCsv, formatCell, formatDuration, nf, toCsv } from "@/lib/utils";

const POR_PAGINA = 8;

interface ResultTableProps {
  result: QueryResult;
}

export function ResultTable({ result }: ResultTableProps) {
  const [ordem, setOrdem] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [pagina, setPagina] = useState(0);

  const linhas = useMemo(() => {
    if (!ordem) return result.rows;
    const copia = [...result.rows];
    copia.sort((a, b) => {
      const r = compareValues(a[ordem.col], b[ordem.col]);
      return ordem.dir === "asc" ? r : -r;
    });
    return copia;
  }, [result.rows, ordem]);

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = linhas.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);

  function alternarOrdem(col: number) {
    setPagina(0);
    setOrdem((o) =>
      o?.col === col ? (o.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" },
    );
  }

  if (result.nRows === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center">
        <Inbox aria-hidden className="h-5 w-5 text-ink-subtle" />
        <p className="text-[13px] font-medium text-ink-muted">A consulta não retornou linhas</p>
        <p className="max-w-sm text-xs text-ink-subtle">
          A consulta rodou sem erro — o recorte pedido simplesmente não existe na base.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">
            {nf.format(result.nRows)} {result.nRows === 1 ? "linha" : "linhas"}
          </Badge>
          <Badge>{formatDuration(result.elapsed)}</Badge>
          {result.truncated && <Badge tone="caution">resultado truncado</Badge>}
        </div>
        <Button
          size="sm"
          variant="subtle"
          onClick={() =>
            downloadCsv(`consulta-sih-${Date.now()}.csv`, toCsv(result.columns, linhas))
          }
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          CSV
        </Button>
      </div>

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {result.columns.map((c, i) => {
                const ativo = ordem?.col === i;
                return (
                  <th key={c + i} scope="col" className="p-0">
                    <button
                      type="button"
                      onClick={() => alternarOrdem(i)}
                      aria-sort={ativo ? (ordem.dir === "asc" ? "ascending" : "descending") : "none"}
                      className="flex w-full items-center gap-1 px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-ink-subtle transition-colors duration-150 ease-out hover:bg-raised hover:text-ink-muted"
                    >
                      <span className="truncate">{c}</span>
                      {ativo &&
                        (ordem.dir === "asc" ? (
                          <ArrowUp aria-hidden className="h-3 w-3 shrink-0 text-accent" />
                        ) : (
                          <ArrowDown aria-hidden className="h-3 w-3 shrink-0 text-accent" />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((linha, i) => (
              <tr
                key={i}
                className="border-b border-line/60 last:border-0 transition-colors duration-150 hover:bg-raised/60"
              >
                {linha.map((v, j) => (
                  <td
                    key={j}
                    className={
                      "whitespace-nowrap px-3 py-2 font-mono text-[12.5px] " +
                      (typeof v === "number" ? "text-right tabular-nums text-ink" : "text-ink-muted")
                    }
                  >
                    {formatCell(v, result.columns[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between border-t border-line px-3 py-2">
          <span className="text-[11px] tabular-nums text-ink-subtle">
            {paginaAtual * POR_PAGINA + 1}–{Math.min((paginaAtual + 1) * POR_PAGINA, linhas.length)}{" "}
            de {nf.format(linhas.length)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="subtle"
              disabled={paginaAtual === 0}
              onClick={() => setPagina((p) => p - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
            </Button>
            <span className="px-1 text-[11px] tabular-nums text-ink-muted">
              {paginaAtual + 1} / {totalPaginas}
            </span>
            <Button
              size="icon-sm"
              variant="subtle"
              disabled={paginaAtual >= totalPaginas - 1}
              onClick={() => setPagina((p) => p + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
