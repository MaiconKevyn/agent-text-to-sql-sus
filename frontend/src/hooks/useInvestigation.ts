import { useCallback, useRef, useState } from "react";
import { BackendOffline, investigate } from "@/lib/api";
import type { InvestigationPhase, Report, ReportBlock } from "@/lib/types";

interface Fase {
  id: InvestigationPhase;
  state: string;
  detail?: string;
}

/**
 * Estado de uma investigação. Separado do `useChat` de propósito: uma
 * investigação leva minutos e produz um relatório, não uma mensagem — misturar
 * os dois estados faria o chat carregar um ciclo de vida que não é o dele.
 */
export function useInvestigation() {
  const [rodando, setRodando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [fase, setFase] = useState<Fase | null>(null);
  const [blocos, setBlocos] = useState<ReportBlock[]>([]);
  const [relatorio, setRelatorio] = useState<Report | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const iniciar = useCallback(async (pergunta: string) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;

    setRodando(true);
    setAberto(true);
    setErro(null);
    setBlocos([]);
    setRelatorio(null);
    setFase({ id: "planejar", state: "ativo" });

    try {
      for await (const ev of investigate(pergunta, { signal: c.signal })) {
        if (c.signal.aborted) break;
        switch (ev.type) {
          case "phase":
            setFase({ id: ev.phase, state: ev.state, detail: detalhe(ev) });
            break;
          case "block":
            setBlocos((atuais) => [...atuais, ev.block]);
            break;
          case "report":
            setRelatorio(ev.report);
            break;
          case "refused":
            setErro(ev.reason);
            break;
          case "failure":
            setErro(ev.message);
            break;
          case "done":
            break;
        }
      }
    } catch (e) {
      // Um `abort` é intencional — o usuário fechou o painel ou começou outra
      // investigação. Mostrar "AbortError: BodyStreamBuffer was aborted" na
      // tela faz um cancelamento parecer uma falha do sistema.
      if (!c.signal.aborted) {
        setErro(
          e instanceof BackendOffline
            ? "O backend não respondeu. Suba com: uvicorn src.api:app --port 8000"
            : String(e),
        );
      }
    } finally {
      if (!c.signal.aborted) {
        setRodando(false);
        setFase(null);
      }
    }
  }, []);

  const cancelar = useCallback(() => {
    ctrl.current?.abort();
    setRodando(false);
    setFase(null);
  }, []);

  const fechar = useCallback(() => {
    cancelar();
    setAberto(false);
  }, [cancelar]);

  return { rodando, aberto, fase, blocos, relatorio, erro, iniciar, cancelar, fechar };
}

/** A linha de detalhe sob o nome da fase. É o que prova que não travou. */
function detalhe(ev: {
  phase: InvestigationPhase;
  state: string;
  steps?: unknown[];
  ok?: number;
  total?: number;
  extra?: number;
  gap?: string;
}): string | undefined {
  if (ev.phase === "planejar" && ev.steps) {
    return `${ev.steps.length} consulta(s) planejada(s)`;
  }
  if ((ev.phase === "executar" || ev.phase === "aprofundar") && ev.total != null) {
    return ev.state === "ativo"
      ? `${ev.total} consulta(s) em paralelo`
      : `${ev.ok} de ${ev.total} com resultado`;
  }
  if (ev.phase === "refletir" && ev.state === "concluido") {
    return ev.extra ? `${ev.extra} consulta(s) a mais: ${ev.gap ?? ""}`.trim() : "argumento fechado";
  }
  return undefined;
}
