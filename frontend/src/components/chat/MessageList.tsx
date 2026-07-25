import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown } from "lucide-react";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { Feedback, Message } from "@/lib/types";
import { AgentMessageBubble } from "./AgentMessage";
import { EmptyState } from "./EmptyState";
import { FollowUpChips } from "./FollowUpChips";
import { UserMessageBubble } from "./UserMessage";

interface MessageListProps {
  messages: Message[];
  debug: boolean;
  busy: boolean;
  onPick: (q: string) => void;
  onRegenerate: (id: string) => void;
  onFeedback: (id: string, v: Feedback) => void;
}

export function MessageList({
  messages,
  debug,
  busy,
  onPick,
  onRegenerate,
  onFeedback,
}: MessageListProps) {
  const ultima = messages[messages.length - 1];
  const { ref, atBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>(
    [
      messages.length,
      ultima?.role === "agent" ? ultima.text.length : 0,
      ultima?.role === "agent" ? ultima.trace.length : 0,
    ],
    messages.length > 0,
  );

  const followUps =
    ultima?.role === "agent" && ultima.status === "pronto"
      ? (ultima.payload?.followUps ?? [])
      : [];

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} className="scroll-thin h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-3 pb-6 pt-4 sm:px-5">
          {messages.length === 0 ? (
            <EmptyState onPick={onPick} />
          ) : (
            <div
              className="space-y-6"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Conversa"
            >
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserMessageBubble key={m.id} message={m} />
                ) : (
                  <AgentMessageBubble
                    key={m.id}
                    message={m}
                    debug={debug}
                    busy={busy}
                    onRegenerate={onRegenerate}
                    onFeedback={onFeedback}
                  />
                ),
              )}
              {followUps.length > 0 && (
                <FollowUpChips questions={followUps} disabled={busy} onPick={onPick} />
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {!atBottom && messages.length > 0 && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => scrollToBottom()}
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-muted shadow-panel transition-colors duration-150 hover:text-ink"
          >
            <ArrowDown aria-hidden className="h-3.5 w-3.5" />
            Voltar ao fim
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
