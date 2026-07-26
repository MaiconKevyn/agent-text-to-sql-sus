import { AlertTriangle, Check, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { countConcept, resolveConcept } from "@/lib/api";
import type { Concept, ConceptCandidate } from "@/lib/types";

const nf = new Intl.NumberFormat("pt-BR");

interface Props {
  /** Chamado quando o usuário confirma: recebe a frase a anexar à pergunta. */
  onConfirm: (clausula: string) => void;
  onClose: () => void;
}

/**
 * Mostra o que um termo clínico significa NESTA base, antes de a consulta rodar.
 *
 * Existe porque o agente erra a definição operacional mais do que erra SQL, e o
 * erro de definição sai plausível: "covid" em U07 devolve zero quando a COVID
 * está em B342; "parto" num único procedimento perde 1,19 milhão de partos.
 * O modelo propõe a seleção, o usuário confirma, o código monta o filtro.
 */
export function ConceptPanel({ onConfirm, onClose }: Props) {
  const [termo, setTermo] = useState("");
  const [conceito, setConceito] = useState<Concept | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const [recontando, setRecontando] = useState(false);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => entrada.current?.focus(), []);

  const chave = (c: ConceptCandidate) => `${c.column}:${c.code}`;

  const buscar = useCallback(async () => {
    const t = termo.trim();
    if (t.length < 3) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setCarregando(true);
    setErro(null);
    setConceito(null);
    try {
      const r = await resolveConcept(t, c.signal);
      setConceito(r);
      setMarcados(new Set(r.candidates.filter((x) => x.suggested).map(chave)));
      setTotal(r.total);
    } catch (e) {
      if (!c.signal.aborted) setErro(String(e));
    } finally {
      if (!c.signal.aborted) setCarregando(false);
    }
  }, [termo]);

  /** Toda mudança de seleção reconta NO BANCO — nunca soma no cliente. */
  const alterna = useCallback(
    async (c: ConceptCandidate) => {
      if (!conceito) return;
      const novos = new Set(marcados);
      novos.has(chave(c)) ? novos.delete(chave(c)) : novos.add(chave(c));
      setMarcados(novos);

      const sel = conceito.candidates.filter((x) => novos.has(chave(x)));
      setRecontando(true);
      try {
        setTotal(await countConcept(sel));
      } catch {
        setTotal(0);
      } finally {
        setRecontando(false);
      }
    },
    [conceito, marcados],
  );

  const selecionados = conceito?.candidates.filter((c) => marcados.has(chave(c))) ?? [];

  function confirmar() {
    if (!conceito || selecionados.length === 0) return;
    const porColuna = new Map<string, string[]>();
    for (const c of selecionados) {
      const alvo = c.column === "DIAG_PRINC_CAT" ? "LEFT(DIAG_PRINC,3)" : c.column;
      porColuna.set(alvo, [...(porColuna.get(alvo) ?? []), c.code]);
    }
    const cond = [...porColuna.entries()]
      .map(([alvo, cods]) => `${alvo} IN (${[...cods].sort().map((c) => `'${c}'`).join(", ")})`)
      .join(" OR ");
    onConfirm(
      ` Considere "${conceito.term}" como exatamente as internações em que ${cond}. ` +
        `Esta definição foi conferida: não a altere nem a amplie.`,
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-canvas">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <Search aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold text-ink">O que este termo significa aqui</h2>
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-subtle">
            Confira o recorte antes de perguntar. É onde as respostas erram mais.
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar painel de definição"
          className="rounded-lg p-1 text-ink-subtle transition-colors duration-150 hover:bg-raised hover:text-ink"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </header>

      <div className="border-b border-line px-4 py-3">
        <div className="flex gap-2">
          <input
            ref={entrada}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && buscar()}
            placeholder="parto, covid, câncer, infarto…"
            aria-label="Termo clínico"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent"
          />
          <button
            onClick={buscar}
            disabled={termo.trim().length < 3 || carregando}
            className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
          >
            {carregando ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : "Buscar"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {erro && (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] text-ink">{erro}</p>
        )}

        {!conceito && !carregando && !erro && (
          <p className="px-1 py-6 text-center text-[12.5px] leading-relaxed text-ink-subtle">
            Digite um termo para ver em quais códigos ele existe nesta base,
            <br />
            com quantas internações cada um tem.
          </p>
        )}

        {conceito?.alert && (
          <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-caution/25 bg-caution-soft px-3.5 py-3">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
            <p className="text-[12px] leading-relaxed text-ink">{conceito.alert}</p>
          </div>
        )}

        {conceito && conceito.candidates.length === 0 && (
          <p className="px-1 py-6 text-center text-[12.5px] text-ink-subtle">
            Nenhum código desta base menciona “{conceito.term}”.
          </p>
        )}

        {conceito && conceito.candidates.length > 0 && (
          <ul className="space-y-1.5">
            {conceito.candidates.map((c) => {
              const ativo = marcados.has(chave(c));
              return (
                <li key={chave(c)}>
                  <button
                    onClick={() => alterna(c)}
                    aria-pressed={ativo}
                    className={
                      "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors duration-150 " +
                      (ativo
                        ? "border-accent/40 bg-accent-soft"
                        : "border-line bg-surface hover:border-accent/25")
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150 " +
                        (ativo ? "border-accent bg-accent" : "border-line")
                      }
                    >
                      {ativo && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <code className="text-[11px] font-medium text-ink-muted">{c.code}</code>
                        <Badge tone="neutral">
                          {c.source === "cid" ? "diagnóstico" : "procedimento"}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-ink">
                        {c.description}
                      </span>
                      {!ativo && c.note && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-ink-subtle">
                          {c.note}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 pt-0.5 text-[11.5px] tabular-nums text-ink-muted">
                      {nf.format(c.admissions)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {conceito && conceito.candidates.length > 0 && (
        <footer className="border-t border-line px-4 py-3">
          <div className="mb-2.5 flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] text-ink-subtle">
              {selecionados.length} de {conceito.candidates.length} códigos
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-ink">
              {recontando ? (
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-ink-subtle" />
              ) : (
                `${nf.format(total)} internações`
              )}
            </span>
          </div>
          {/* O total é contado no banco a cada mudança. Somar aqui daria
              43.564.593 para "parto", onde a união real é 25.010.349 — as duas
              fontes descrevem as MESMAS internações. */}
          <p className="mb-2.5 text-[11px] leading-snug text-ink-subtle">
            Contado no banco, sem somar as fontes — a mesma internação tem
            procedimento e diagnóstico.
          </p>
          <button
            onClick={confirmar}
            disabled={selecionados.length === 0}
            className="w-full rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
          >
            Usar esta definição na pergunta
          </button>
        </footer>
      )}
    </div>
  );
}
