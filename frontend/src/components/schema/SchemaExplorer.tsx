import { AlertTriangle, ChevronRight, Loader2, PlugZap, Search, Table2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useSchema } from "@/hooks/useSchema";
import type { SchemaTable } from "@/lib/types";
import { cn, fold, nf } from "@/lib/utils";

interface SchemaExplorerProps {
  /** Insere uma referência à tabela no campo de pergunta. */
  onPickTable: (nome: string) => void;
  onClose?: () => void;
}

function LinhaTabela({
  t,
  busca,
  onPick,
}: {
  t: SchemaTable;
  busca: string;
  onPick: (n: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const q = fold(busca);
  const colunas = useMemo(
    () =>
      q
        ? t.columns.filter((c) => fold(c.name).includes(q) || fold(c.desc).includes(q))
        : t.columns,
    [t.columns, q],
  );
  const indisponivel = t.empty || t.forbidden;

  return (
    <li className="border-b border-line/70 last:border-0">
      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-raised"
        >
          <ChevronRight
            aria-hidden
            className="h-3 w-3 shrink-0 text-ink-subtle transition-transform duration-200 ease-out"
            style={{ transform: aberto ? "rotate(90deg)" : undefined }}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[12.5px]",
              indisponivel ? "text-ink-subtle line-through" : "text-ink",
            )}
          >
            {t.name}
          </span>
          {t.role === "fato" && <Badge tone="accent">fato</Badge>}
          {indisponivel ? (
            <Badge tone="critical">{t.forbidden ? "bloqueada" : "vazia"}</Badge>
          ) : (
            <span className="shrink-0 text-[10.5px] tabular-nums text-ink-subtle">
              {nf.format(t.rows)}
            </span>
          )}
        </button>
        {!indisponivel && (
          <Button
            size="icon-sm"
            onClick={() => onPick(t.name)}
            aria-label={`Usar ${t.name} na pergunta`}
            title="Usar na pergunta"
          >
            <Table2 aria-hidden className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Collapsible open={aberto}>
        <div className="space-y-2 bg-raised/50 px-3 pb-3 pt-1">
          {t.description && (
            <p className="text-[11.5px] leading-relaxed text-ink-muted">{t.description}</p>
          )}
          {t.caveat && (
            <p className="flex items-start gap-1.5 rounded-md bg-caution-soft px-2 py-1.5 text-[11px] leading-relaxed text-ink-muted">
              <AlertTriangle aria-hidden className="mt-px h-3 w-3 shrink-0 text-caution" />
              <span>{t.caveat}</span>
            </p>
          )}
          {t.domain && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(t.domain).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle"
                >
                  {k} = {v}
                </span>
              ))}
            </div>
          )}
          {colunas.length > 0 && (
            <ul className="space-y-1">
              {colunas.map((c) => (
                <li key={c.name} className="leading-snug">
                  <span className="font-mono text-[11.5px] text-ink">{c.name}</span>
                  {c.type && (
                    <span className="ml-1.5 font-mono text-[10px] uppercase text-ink-subtle">
                      {c.type}
                    </span>
                  )}
                  {c.desc && (
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                      {c.desc}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Collapsible>
    </li>
  );
}

export function SchemaExplorer({ onPickTable, onClose }: SchemaExplorerProps) {
  const [busca, setBusca] = useState("");
  const estado = useSchema();
  const schema = estado.status === "pronto" ? estado.schema : null;

  const tabelas = useMemo(() => {
    if (!schema) return [];
    const q = fold(busca.trim());
    if (!q) return schema.tables;
    return schema.tables.filter(
      (t) =>
        fold(t.name).includes(q) ||
        fold(t.description).includes(q) ||
        t.columns.some((c) => fold(c.name).includes(q) || fold(c.desc).includes(q)),
    );
  }, [busca, schema]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-3">
        <h2 className="flex-1 text-[13px] font-semibold tracking-tight text-ink">
          Estrutura do banco
        </h2>
        {onClose && (
          <Button size="icon-sm" onClick={onClose} aria-label="Fechar painel">
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      <div className="border-b border-line px-3 py-2.5">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
          />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar tabela ou coluna…"
            aria-label="Buscar tabela ou coluna"
            className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-line-strong"
          />
        </div>
        {schema && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
            {schema.period.split("\n")[0]}
          </p>
        )}
      </div>

      {estado.status === "carregando" && (
        <p className="flex items-center justify-center gap-2 px-3.5 py-8 text-[12px] text-ink-subtle">
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          Carregando a estrutura…
        </p>
      )}

      {estado.status === "erro" && (
        <div className="flex items-start gap-2 px-3.5 py-6 text-[12px] leading-relaxed text-ink-muted">
          <PlugZap aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" />
          <span>
            Não foi possível carregar a estrutura do banco. Confira se o agente está no
            ar. <span className="text-ink-subtle">({estado.message})</span>
          </span>
        </div>
      )}

      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {schema && tabelas.length === 0 ? (
          <li className="px-3.5 py-6 text-center text-[12px] text-ink-subtle">
            Nada encontrado para “{busca}”.
          </li>
        ) : (
          tabelas.map((t) => (
            <LinhaTabela key={t.name} t={t} busca={busca} onPick={onPickTable} />
          ))
        )}
      </ul>
    </div>
  );
}
