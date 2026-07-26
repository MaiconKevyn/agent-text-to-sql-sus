import { MotionConfig, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { SchemaExplorer } from "@/components/schema/SchemaExplorer";
import { ReportPanel } from "@/components/report/ReportPanel";
import { ConceptPanel } from "@/components/concept/ConceptPanel";
import { useInvestigation } from "@/hooks/useInvestigation";
import { useThemes } from "@/hooks/useThemes";
import { Sidebar } from "@/components/Sidebar";
import { useChat } from "@/hooks/useChat";
import { cn } from "@/lib/utils";

const DEBUG_KEY = "sih-debug";
const BARRA_KEY = "sih-barra";
const PAINEL_KEY = "sih-schema-aberto";

function lerFlag(chave: string, padrao: boolean): boolean {
  try {
    const v = localStorage.getItem(chave);
    return v === null ? padrao : v === "1";
  } catch {
    return padrao;
  }
}

export default function App() {
  const { messages, busy, send, regenerate, setFeedback, stop, clear, abrir: abrirChat, chatAtual, versao } = useChat();
  const composer = useRef<ComposerHandle>(null);

  const [debug, setDebug] = useState(() => lerFlag(DEBUG_KEY, false));
  const [schemaOpen, setSchemaOpen] = useState(() => lerFlag(PAINEL_KEY, false));
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
  );
  const reduzirMovimento = useReducedMotion();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const on = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DEBUG_KEY, debug ? "1" : "0");
    } catch {
      /* ignora */
    }
  }, [debug]);

  useEffect(() => {
    try {
      localStorage.setItem(PAINEL_KEY, schemaOpen ? "1" : "0");
    } catch {
      /* ignora */
    }
  }, [schemaOpen]);

  // Esc fecha o painel de schema quando ele está sobreposto (mobile).
  useEffect(() => {
    if (!schemaOpen || !isMobile) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && setSchemaOpen(false);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [schemaOpen, isMobile]);

  const perguntar = useCallback(
    (q: string) => {
      send(q);
      if (isMobile) setSchemaOpen(false);
    },
    [send, isMobile],
  );

  const usarTabela = useCallback(
    (nome: string) => {
      composer.current?.append(`na tabela ${nome},`);
      if (isMobile) setSchemaOpen(false);
    },
    [isMobile],
  );

  const inv = useInvestigation();
  const { temas, ultimo, criar, fixar } = useThemes();
  const [barraAberta, setBarraAberta] = useState(() => lerFlag(BARRA_KEY, true));

  useEffect(() => {
    try {
      localStorage.setItem(BARRA_KEY, barraAberta ? "1" : "0");
    } catch {
      /* modo privado: segue sem lembrar */
    }
  }, [barraAberta]);
  const [conceitoAberto, setConceitoAberto] = useState(false);

  // A definição confirmada é anexada à pergunta, não guardada em estado à
  // parte: assim ela viaja no histórico, aparece no trace e fica registrada
  // junto da resposta que produziu.
  const usarDefinicao = useCallback((clausula: string) => {
    composer.current?.append(clausula);
    setConceitoAberto(false);
  }, []);

  const painel = (
    <SchemaExplorer
      onPickTable={usarTabela}
      onClose={isMobile ? () => setSchemaOpen(false) : undefined}
    />
  );

  return (
    <MotionConfig reducedMotion={reduzirMovimento ? "always" : "never"}>
      <div className="flex h-full flex-col bg-canvas">
        <AppHeader
          debug={debug}
          onDebugChange={setDebug}
          schemaOpen={schemaOpen}
          onToggleSchema={() => setSchemaOpen((v) => !v)}
          sidebarOpen={barraAberta}
          onToggleSidebar={() => setBarraAberta((v) => !v)}
          hasMessages={messages.length > 0}
          onClear={clear}
        />

        <div className="mx-auto flex w-full min-h-0 max-w-[1500px] flex-1">
          {/* A barra é recolhível porque o painel da direita já existe: com os
              dois lados fixos, o conteúdo central sufoca num laptop de 1280px. */}
          <aside
            aria-hidden={!barraAberta}
            className={cn(
              "hidden min-h-0 shrink-0 overflow-hidden lg:block",
              "transition-[width] duration-200 ease-out",
              barraAberta ? "w-60" : "w-0",
            )}
          >
            <div className="h-full w-60">
              <Sidebar
                atual={chatAtual ? { tipo: "chats", id: chatAtual } : null}
                versao={versao}
                onNovoChat={clear}
                onAbrirChat={(id) => void abrirChat(id)}
                onAbrirTema={(id) => {
                  location.href = `?tema=${id}`;
                }}
                onNovoTema={() => {
                  location.href = "?temas";
                }}
              />
            </div>
          </aside>

          <main className="flex min-w-0 min-h-0 flex-1 flex-col">
            <MessageList
              messages={messages}
              debug={debug}
              busy={busy}
              onPick={perguntar}
              onRegenerate={regenerate}
              onFeedback={setFeedback}
              onInvestigate={inv.iniciar}
              onCorrectContinuity={perguntar}
              temas={{ temas, ultimo, fixar, criar }}
            />
            <div className="border-t border-line bg-canvas/85 px-3 py-3 backdrop-blur-md sm:px-5">
              <div className="mx-auto max-w-3xl">
                <Composer
                  ref={composer}
                  busy={busy}
                  onSend={perguntar}
                  onDefineTerm={() => setConceitoAberto(true)}
                  onStop={stop}
                />
                <p className="mt-2 px-1 text-center text-[11px] leading-relaxed text-ink-subtle">
                  Dados agregados de internações do SUS. Nenhuma informação individual de
                  paciente é acessada.
                </p>
              </div>
            </div>
          </main>

          {/* Desktop: painel lateral que empurra o conteúdo.
              A largura é animada por CSS, não por JS: se o quadro de animação
              não rodar, o painel ainda assim chega à largura final em vez de
              ficar parado no meio, cortando o conteúdo. */}
          <aside
            aria-label={
              inv.aberto
                ? "Relatório da investigação"
                : conceitoAberto
                  ? "Definição de termo"
                  : "Estrutura do banco"
            }
            aria-hidden={!(schemaOpen || conceitoAberto || inv.aberto) || isMobile}
            className={cn(
              "hidden min-h-0 shrink-0 overflow-hidden border-l border-line lg:block",
              "transition-[width] duration-200 ease-out",
              inv.aberto ? "w-[30rem]" : conceitoAberto || schemaOpen ? "w-80" : "w-0",
            )}
          >
            {/* A largura anima em CSS; o conteúdo tem largura fixa para não
                refluir durante a transição. O relatório é mais largo porque
                carrega tabela e gráfico, não só nome de coluna. */}
            <div className={inv.aberto ? "h-full w-[30rem]" : "h-full w-80"}>
              {inv.aberto ? (
                <ReportPanel
                  report={inv.relatorio}
                  phase={inv.fase}
                  blocks={inv.blocos}
                  error={inv.erro}
                  onClose={inv.fechar}
                />
              ) : conceitoAberto ? (
                <ConceptPanel
                  onConfirm={usarDefinicao}
                  onClose={() => setConceitoAberto(false)}
                />
              ) : (
                painel
              )}
            </div>
          </aside>
        </div>

        {/* Em tela estreita o painel lateral não existe (lg:block), então o
            relatório precisa do próprio caminho — senão a investigação roda e
            não aparece em lugar nenhum. */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Relatório da investigação"
          aria-hidden={!inv.aberto}
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 h-[85vh] overflow-hidden rounded-t-2xl",
            "border-t border-line shadow-panel lg:hidden",
            "transition-transform duration-200 ease-out",
            inv.aberto ? "translate-y-0" : "pointer-events-none translate-y-full",
          )}
        >
          <ReportPanel
            report={inv.relatorio}
            phase={inv.fase}
            blocks={inv.blocos}
            error={inv.erro}
            onClose={inv.fechar}
          />
        </div>

        {/* Mobile: bottom sheet, também em CSS. */}
        {isMobile && (
          <>
            <div
              onClick={() => setSchemaOpen(false)}
              aria-hidden
              className={cn(
                "fixed inset-0 z-30 bg-ink/25 backdrop-blur-[2px] lg:hidden",
                "transition-opacity duration-200 ease-out",
                schemaOpen ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Estrutura do banco"
              aria-hidden={!schemaOpen}
              className={cn(
                "fixed inset-x-0 bottom-0 z-40 h-[72vh] overflow-hidden rounded-t-2xl",
                "border-t border-line shadow-panel lg:hidden",
                "transition-transform duration-200 ease-out",
                schemaOpen ? "translate-y-0" : "pointer-events-none translate-y-full",
              )}
            >
              <span
                aria-hidden
                className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-line-strong"
              />
              <div className="h-full pt-3">{painel}</div>
            </div>
          </>
        )}
      </div>
    </MotionConfig>
  );
}
