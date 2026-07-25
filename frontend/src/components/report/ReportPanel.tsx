import { AlertTriangle, ChevronRight, FlaskConical, Search, X } from "lucide-react";
import { useState } from "react";
import { ResultChart } from "@/components/result/ResultChart";
import { ResultTable } from "@/components/result/ResultTable";
import { SqlBlock } from "@/components/result/SqlBlock";
import { Badge } from "@/components/ui/badge";
import { StreamedText } from "@/components/chat/StreamedText";
import { PHASE_LABELS, type InvestigationPhase, type Report, type ReportBlock } from "@/lib/types";

interface Props {
  report: Report | null;
  /** Fases já vistas, para o painel não ficar mudo durante os minutos de espera. */
  phase: { id: InvestigationPhase; state: string; detail?: string } | null;
  blocks: ReportBlock[];
  error: string | null;
  onClose: () => void;
}

export function ReportPanel({ report, phase, blocks, error, onClose }: Props) {
  const pronto = report !== null;
  const visiveis = report?.blocks ?? blocks;

  return (
    // Sem landmark próprio: quem rotula é o container (o <aside> do painel
    // lateral ou o <div role="dialog"> da folha inferior). Rotular aqui também
    // criava dois landmarks aninhados com o mesmo nome — um leitor de tela
    // anuncia "Relatório da investigação" duas vezes seguidas.
    <div className="flex h-full w-full flex-col bg-canvas">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold leading-snug text-ink">
            {report?.question ?? "Investigação"}
          </h2>
          {pronto && (
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">
              {report.stepsOk} de {report.blocks.length} consultas · {report.elapsed}s ·{" "}
              {report.llmCalls} chamadas ao modelo
              {report.stepsFromReflection > 0 &&
                ` · ${report.stepsFromReflection} da revisão`}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar relatório"
          className="rounded-lg p-1 text-ink-subtle transition-colors duration-150 hover:bg-raised hover:text-ink"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error && <Aviso tom="erro">{error}</Aviso>}

        {!pronto && !error && phase && <Andamento phase={phase} feitos={blocks.length} />}

        {report?.refusal && <Aviso tom="atencao">{report.refusal}</Aviso>}

        {report?.reading && (
          <section className="mb-4 rounded-xl border border-line bg-surface px-4 py-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              Como a pergunta foi lida
            </h3>
            <p className="text-[12.5px] leading-relaxed text-ink-muted">{report.reading}</p>
          </section>
        )}

        {report?.text && (
          <section className="mb-5">
            <StreamedText text={report.text} streaming={false} />
          </section>
        )}

        {report?.gap && (
          <Aviso tom="atencao">
            <span className="font-medium">Lacuna que ficou aberta:</span> {report.gap}
          </Aviso>
        )}

        {visiveis.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              Evidências ({visiveis.length})
            </h3>
            <div className="space-y-2.5">
              {visiveis.map((b, i) => (
                <BlocoEvidencia key={`${b.question}-${i}`} bloco={b} indice={i + 1} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function Andamento({
  phase,
  feitos,
}: {
  phase: { id: InvestigationPhase; state: string; detail?: string };
  feitos: number;
}) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3">
      <Search aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-accent" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{PHASE_LABELS[phase.id]}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-subtle">
          {phase.detail ?? (feitos > 0 ? `${feitos} evidência(s) coletada(s)` : "…")}
        </p>
      </div>
    </div>
  );
}

function Aviso({ tom, children }: { tom: "erro" | "atencao"; children: React.ReactNode }) {
  const cor =
    tom === "erro"
      ? "border-critical/25 bg-critical-soft text-ink"
      : "border-caution/25 bg-caution-soft text-ink";
  return (
    <div className={`mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 ${cor}`}>
      <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
      <p className="text-[12.5px] leading-relaxed">{children}</p>
    </div>
  );
}

function BlocoEvidencia({ bloco, indice }: { bloco: ReportBlock; indice: number }) {
  const [aberto, setAberto] = useState(false);
  const daRevisao = bloco.origin === "reflexao";

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-raised"
      >
        <ChevronRight
          aria-hidden
          className={`mt-0.5 h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-150 ${
            aberto ? "rotate-90" : ""
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-ink-subtle">{indice}</span>
            {daRevisao && (
              <Badge tone="accent">
                da revisão
              </Badge>
            )}
            {bloco.error && <Badge tone="critical">falhou</Badge>}
            {bloco.result && (
              <Badge tone="neutral">
                {bloco.result.nRows.toLocaleString("pt-BR")} linha
                {bloco.result.nRows === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug text-ink">
            {bloco.question}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-subtle">{bloco.purpose}</p>
        </div>
      </button>

      {aberto && (
        <div className="space-y-2.5 border-t border-line px-3.5 py-3">
          {/* A definição vem antes de qualquer número. Foi um achado dos testes:
              "câncer" tinha virado C00-C97 MAIS D00-D48, que inclui neoplasia
              benigna — o número certo com o rótulo errado. */}
          {bloco.definition && (
            <div className="rounded-lg bg-raised px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                O que foi medido
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                {bloco.definition}
              </p>
            </div>
          )}

          {bloco.error && (
            <p className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] text-ink">
              {bloco.error}
            </p>
          )}

          {bloco.assumptions.length > 0 && (
            <p className="text-[11.5px] leading-relaxed text-ink-subtle">
              <span className="font-medium">Suposições:</span> {bloco.assumptions.join(" · ")}
            </p>
          )}

          {bloco.chart && bloco.result && (
            <ResultChart spec={bloco.chart} result={bloco.result} />
          )}
          {bloco.sql && <SqlBlock sql={bloco.sql} />}
          {bloco.result && <ResultTable result={bloco.result} />}
        </div>
      )}
    </article>
  );
}
