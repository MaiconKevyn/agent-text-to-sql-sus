import { useCallback, useRef, useState } from "react";
import { appendTurn, ask, BackendOffline, createChat, readChat } from "@/lib/api";
import {
  STEP_LABELS,
  type AgentMessage,
  type Feedback,
  type Message,
  type StepId,
  type Turn,
  type ChatTurn,
} from "@/lib/types";
import { uid } from "@/lib/utils";

/** Quantas rodadas anteriores acompanham a pergunta. */
const HISTORICO = 3;

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

  /** Últimas rodadas com SQL, para o backend resolver "e em 2020?". */
  const historico = useRef<Turn[]>([]);

  // A conversa é salva desde a PRIMEIRA pergunta, incrementalmente. Quem fecha
  // a aba não avisa antes — se o salvamento esperasse um gesto explícito, a
  // conversa perdida seria justamente a que ninguém lembrou de salvar.
  const chatId = useRef<string | null>(null);
  const [chatAtual, setChatAtual] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  const salvarRodada = useCallback(async (rodada: Partial<ChatTurn>) => {
    try {
      if (!chatId.current) {
        const c = await createChat();
        chatId.current = c.id;
        setChatAtual(c.id);
      }
      await appendTurn(chatId.current, rodada);
      setVersao((v) => v + 1);  // a barra lateral reflete o título novo
    } catch {
      // Não salvar é ruim; derrubar a resposta que o usuário acabou de receber
      // é pior. O erro fica silencioso de propósito.
    }
  }, []);

  const consumir = useCallback(
    async (pergunta: string, respostaId: string) => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);

      // O que será salvo, acumulado fora do estado do React.
      //
      // A primeira versão chamava `salvarRodada` DENTRO do atualizador passado
      // a `setMessages`. Um atualizador tem de ser puro, e o StrictMode — que
      // os invoca duas vezes justamente para expor impureza — gravou a mesma
      // conversa duas vezes. Efeito colateral não mora em atualizador.
      const rodada: Partial<ChatTurn> = { question: pergunta };
      try {
        for await (const ev of ask(pergunta, {
          signal: ctrl.signal,
          history: historico.current,
        })) {
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
              rodada.sql = ev.sql;
              patch(respostaId, (m) => ({ ...m, payload: { ...m.payload, sql: ev.sql } }));
              break;
            case "result":
              rodada.result = ev.result;
              patch(respostaId, (m) => ({ ...m, payload: { ...m.payload, result: ev.result } }));
              break;
            case "continuity":
              patch(respostaId, (m) => ({
                ...m,
                payload: { ...m.payload, continuity: ev.continuity },
              }));
              break;
            case "chart":
              rodada.chart = ev.chart;
              patch(respostaId, (m) => ({ ...m, payload: { ...m.payload, chart: ev.chart } }));
              break;
            case "assumptions":
              rodada.assumptions = ev.assumptions;
              patch(respostaId, (m) => ({
                ...m,
                payload: { ...m.payload, assumptions: ev.assumptions },
              }));
              break;
            case "refused":
              patch(respostaId, (m) => ({ ...m, payload: { ...m.payload, refused: true } }));
              break;
            case "token":
              rodada.text = (rodada.text ?? "") + ev.text;
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
              patch(respostaId, (m) => {
                // Só rodada com SQL executável serve de base para o próximo
                // acompanhamento; uma recusa não deixa nada para reaproveitar.
                if (m.payload?.sql) {
                  historico.current = [
                    ...historico.current,
                    { question: pergunta, sql: m.payload.sql },
                  ].slice(-HISTORICO);
                }
                return { ...m, status: "pronto" };
              });
              break;
          }
        }
      } catch (erro) {
        if (ctrl.signal.aborted) return;
        const offline = erro instanceof BackendOffline;
        patch(respostaId, (m) => ({
          ...m,
          status: "erro",
          failure: {
            kind: offline ? "offline" : "rede",
            message: offline
              ? `Não foi possível falar com o agente em ${import.meta.env.VITE_API_URL ?? "http://localhost:8000"}. ` +
                `Confira se o servidor está no ar: uvicorn src.api:app --port 8000 (${erro.causa})`
              : erro instanceof Error
                ? erro.message
                : "Erro inesperado.",
          },
          steps: m.steps.map((s) => (s.state === "ativo" ? { ...s, state: "falhou" } : s)),
        }));
      } finally {
        setBusy(false);
        abort.current = null;
        // Uma gravação por rodada, depois que o stream fechou.
        if (!ctrl.signal.aborted && rodada.sql) void salvarRodada(rodada);
      }
    },
    [patch, salvarRodada],
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

  /** Começa uma conversa nova. A anterior fica salva e acessível na barra. */
  const clear = useCallback(() => {
    abort.current?.abort();
    historico.current = [];
    chatId.current = null;
    setChatAtual(null);
    setMessages([]);
  }, []);

  /** Retoma uma conversa salva: reconstrói as mensagens e o histórico. */
  const abrir = useCallback(async (id: string) => {
    abort.current?.abort();
    const c = await readChat(id);
    chatId.current = c.id;
    setChatAtual(c.id);
    historico.current = (c.turns ?? [])
      .filter((t) => t.sql)
      .map((t) => ({ question: t.question, sql: t.sql }))
      .slice(-HISTORICO);
    setMessages(
      (c.turns ?? []).flatMap((t) => [
        { id: uid(), role: "user" as const, text: t.question, at: Date.parse(t.at) || Date.now() },
        {
          id: uid(),
          role: "agent" as const,
          text: t.text,
          status: "pronto" as const,
          // As etapas não são guardadas: elas descrevem uma execução que já
          // aconteceu, e mostrá-las como se estivessem rodando seria mentira.
          steps: passosIniciais().map((p) => ({ ...p, state: "concluido" as const })),
          trace: [],
          payload: {
            sql: t.sql ?? undefined,
            result: t.result ?? undefined,
            chart: t.chart ?? undefined,
            assumptions: t.assumptions,
            continuity: t.continuity ?? undefined,
          },
          at: Date.parse(t.at) || Date.now(),
          sourceQuestion: t.question,
        },
      ]),
    );
  }, []);

  return {
    messages, busy, send, regenerate, setFeedback, stop, clear,
    abrir, chatAtual, versao,
  };
}
