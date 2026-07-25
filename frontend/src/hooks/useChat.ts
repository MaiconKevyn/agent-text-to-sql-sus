import { useCallback, useRef, useState } from "react";
import { ask } from "@/mocks/api";
import { STEP_LABELS, type AgentMessage, type Feedback, type Message, type StepId } from "@/lib/types";
import { uid } from "@/lib/utils";

const ORDEM: StepId[] = ["interpretar", "vincular", "gerar-sql", "executar", "resumir"];

const passosIniciais = () =>
  ORDEM.map((id) => ({ id, label: STEP_LABELS[id], state: "pendente" as const }));

function novaRespostaVazia(pergunta: string): AgentMessage {
  return {
    id: uid(),
    role: "agent",
    text: "",
    status: "pensando",
    steps: passosIniciais(),
    trace: [],
    at: Date.now(),
    sourceQuestion: pergunta,
  };
}

/**
 * Estado da conversa e consumo do stream do agente.
 *
 * Os componentes de UI recebem `messages` e chamam `send`/`regenerate`; nenhum
 * deles conhece a forma dos eventos nem a ordem das etapas.
 */
export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  /** Aplica uma alteração na mensagem do agente de id conhecido. */
  const patch = useCallback((id: string, fn: (m: AgentMessage) => AgentMessage) => {
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === "agent" ? fn(m) : m)));
  }, []);

  const consumir = useCallback(
    async (pergunta: string, respostaId: string) => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      try {
        for await (const ev of ask(pergunta, { signal: ctrl.signal })) {
          if (ctrl.signal.aborted) break;
          switch (ev.type) {
            case "step":
              patch(respostaId, (m) => ({
                ...m,
                steps: m.steps.map((s) =>
                  s.id === ev.id
                    ? { ...s, state: ev.state, elapsed: ev.elapsed ?? s.elapsed, detail: ev.detail ?? s.detail }
                    : s,
                ),
              }));
              break;
            case "trace":
              patch(respostaId, (m) => ({ ...m, trace: [...m.trace, ev.entry] }));
              break;
            case "sql":
              patch(respostaId, (m) => ({ ...m, payload: { ...m.payload, sql: ev.sql } }));
              break;
            case "result":
              patch(respostaId, (m) => ({ ...m, payload: { ...m.payload, result: ev.result } }));
              break;
            case "assumptions":
              patch(respostaId, (m) => ({
                ...m,
                payload: { ...m.payload, assumptions: ev.assumptions },
              }));
              break;
            case "refused":
              patch(respostaId, (m) => ({ ...m, payload: { ...m.payload, refused: true } }));
              break;
            case "token":
              patch(respostaId, (m) => ({
                ...m,
                status: "streaming",
                text: m.text + ev.text,
              }));
              break;
            case "follow-ups":
              patch(respostaId, (m) => ({
                ...m,
                payload: { ...m.payload, followUps: ev.questions },
              }));
              break;
            case "failure":
              patch(respostaId, (m) => ({
                ...m,
                status: "erro",
                failure: { kind: ev.kind, message: ev.message },
                steps: m.steps.map((s) =>
                  s.state === "ativo" ? { ...s, state: "falhou" } : s,
                ),
              }));
              break;
            case "done":
              patch(respostaId, (m) => ({ ...m, status: "pronto" }));
              break;
          }
        }
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [patch],
  );

  const send = useCallback(
    (texto: string) => {
      const pergunta = texto.trim();
      if (!pergunta || busy) return;
      const resposta = novaRespostaVazia(pergunta);
      setMessages((ms) => [
        ...ms,
        { id: uid(), role: "user", text: pergunta, at: Date.now() },
        resposta,
      ]);
      void consumir(pergunta, resposta.id);
    },
    [busy, consumir],
  );

  /** Refaz uma resposta do agente, preservando a pergunta que a originou. */
  const regenerate = useCallback(
    (id: string) => {
      if (busy) return;
      const alvo = messages.find((m) => m.id === id);
      if (!alvo || alvo.role !== "agent") return;
      patch(id, () => ({ ...novaRespostaVazia(alvo.sourceQuestion), id }));
      void consumir(alvo.sourceQuestion, id);
    },
    [busy, consumir, messages, patch],
  );

  const setFeedback = useCallback(
    (id: string, valor: Feedback) =>
      patch(id, (m) => ({ ...m, feedback: m.feedback === valor ? undefined : valor })),
    [patch],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    setMessages((ms) =>
      ms.map((m) =>
        m.role === "agent" && (m.status === "streaming" || m.status === "pensando")
          ? { ...m, status: "pronto" }
          : m,
      ),
    );
  }, []);

  const clear = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
  }, []);

  return { messages, busy, send, regenerate, setFeedback, stop, clear };
}
