import { AlertTriangle, Activity, Info, Ban, WifiOff, Timer, PlugZap } from "lucide-react";
import { DebugTrace } from "@/components/debug/DebugTrace";
import { ResultTable } from "@/components/result/ResultTable";
import { ResultChart } from "@/components/result/ResultChart";
import { InvestigateChip } from "@/components/chat/InvestigateChip";
import { ContinuityChip } from "@/components/chat/ContinuityChip";
import { SqlBlock } from "@/components/result/SqlBlock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentMessage as AgentMsg, FailureKind, Feedback, Theme, ThemeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MessageActions } from "./MessageActions";
import { PinButton } from "@/components/theme/PinButton";
import { StreamedText } from "./StreamedText";
import { ThinkingSteps } from "./ThinkingSteps";

/** O que o botão de fixar precisa saber. Definido aqui para não acoplar o
 *  componente de mensagem ao hook inteiro. */
export interface TemasProps {
  temas: Theme[];
  ultimo: Theme | null;
  fixar: (bloco: Partial<ThemeBlock>, temaId?: string) => Promise<string>;
  criar: (titulo: string) => Promise<Theme>;
}

const FALHAS: Record<
  FailureKind,
  { icon: typeof WifiOff; titulo: string; tom: "critical" | "caution" }
> = {
  rede: { icon: WifiOff, titulo: "Sem conexão com o agente", tom: "critical" },
  sql: { icon: Ban, titulo: "A consulta não pôde ser executada", tom: "critical" },
  timeout: { icon: Timer, titulo: "A consulta demorou demais", tom: "critical" },
  offline: { icon: PlugZap, titulo: "O agente não está respondendo", tom: "critical" },
};

interface AgentMessageProps {
  message: AgentMsg;
  debug: boolean;
  busy: boolean;
  onRegenerate: (id: string) => void;
  onFeedback: (id: string, v: Feedback) => void;
  /** Abre o modo investigação para a pergunta desta mensagem. */
  onInvestigate?: (pergunta: string) => void;
  /** Refaz a pergunta com a continuidade corrigida. */
  onCorrectContinuity?: (pergunta: string) => void;
  /** Ponte com os temas. Ausente quando a tela não os oferece. */
  temas?: TemasProps;
}

export function AgentMessageBubble({
  message,
  debug,
  busy,
  onRegenerate,
  onFeedback,
  onInvestigate,
  onCorrectContinuity,
  temas,
}: AgentMessageProps) {
  const { status, payload, failure } = message;
  const pensando = status === "pensando";
  const streaming = status === "streaming";
  const pronto = status === "pronto";
  const Falha = failure ? FALHAS[failure.kind] : null;

  return (
    <article className="group/msg flex animate-fade-up gap-3" aria-label="Resposta do agente">
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface shadow-subtle"
      >
        <Activity className="h-3.5 w-3.5 text-accent" />
      </span>

      <div className="min-w-0 flex-1 space-y-3">
        {/* Etapas: expandidas enquanto trabalha, resumidas depois. */}
        {(pensando || streaming || failure) && (
          <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
            <ThinkingSteps steps={message.steps} />
          </div>
        )}

        {failure && Falha && (
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3.5 py-3",
              Falha.tom === "caution"
                ? "border-caution/25 bg-caution-soft"
                : "border-critical/25 bg-critical-soft",
            )}
          >
            <Falha.icon
              aria-hidden
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                Falha.tom === "caution" ? "text-caution" : "text-critical",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{Falha.titulo}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
                {failure.message}
              </p>
              {/* Vale para todas as falhas: rede volta, timeout pode passar
                  num recorte menor, e o servidor pode ter subido nesse meio. */}
              <Button
                size="sm"
                variant="outline"
                className="mt-2.5"
                disabled={busy}
                onClick={() => onRegenerate(message.id)}
              >
                Tentar de novo
              </Button>
            </div>
          </div>
        )}

        {payload?.refused && (
          <div className="flex items-start gap-2.5 rounded-xl border border-caution/25 bg-caution-soft px-3.5 py-3">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
            <p className="text-[13px] font-medium text-ink">
              Esta pergunta está fora do alcance da base
            </p>
          </div>
        )}

        {payload?.continuity && onCorrectContinuity && (
          <ContinuityChip
            continuity={payload.continuity}
            onCorrect={(instrucao) => onCorrectContinuity(message.sourceQuestion + instrucao)}
          />
        )}

        {message.text && <StreamedText text={message.text} streaming={streaming} />}

        {payload?.assumptions && payload.assumptions.length > 0 && pronto && (
          <div className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
            <div className="min-w-0 text-[12px] leading-relaxed text-ink-muted">
              <span className="font-medium">Suposições:</span>{" "}
              {payload.assumptions.join(" · ")}
            </div>
          </div>
        )}

        {payload?.chart && payload.result && (
          <ResultChart spec={payload.chart} result={payload.result} />
        )}
        {payload?.sql && <SqlBlock sql={payload.sql} />}
        {payload?.result && <ResultTable result={payload.result} />}

        {pronto && onInvestigate && (
          <InvestigateChip question={message.sourceQuestion} onStart={onInvestigate} />
        )}

        {debug && message.trace.length > 0 && <DebugTrace entries={message.trace} />}

        {(pronto || failure) && message.text && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <MessageActions
              text={message.text}
              feedback={message.feedback}
              disabled={busy}
              onRegenerate={() => onRegenerate(message.id)}
              onFeedback={(v) => onFeedback(message.id, v)}
            />
            {/* Fixar leva o bloco INTEIRO — pergunta, SQL, resultado, gráfico e
                a definição usada. Uma referência não bastaria: o bloco tem de
                continuar legível daqui a um mês. */}
            {temas && payload?.result && (
              <PinButton
                temas={temas.temas}
                ultimo={temas.ultimo}
                onPin={temas.fixar}
                onNovo={temas.criar}
                bloco={() => ({
                  kind: "consulta",
                  provenance: "banco",
                  title: payload.chart?.title || message.sourceQuestion.slice(0, 80),
                  question: message.sourceQuestion,
                  text: message.text,
                  sql: payload.sql ?? null,
                  result: payload.result ?? null,
                  chart: payload.chart ?? null,
                  assumptions: payload.assumptions ?? [],
                })}
              />
            )}
            {debug && (
              <Badge tone="neutral" className="shrink-0">
                {message.trace.length} eventos no trace
              </Badge>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
