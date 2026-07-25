import type { UserMessage as UserMsg } from "@/lib/types";

export function UserMessageBubble({ message }: { message: UserMsg }) {
  return (
    <div className="flex animate-fade-up justify-end">
      <p
        className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-accent-ink shadow-subtle sm:max-w-[75%]"
        aria-label="Sua pergunta"
      >
        {message.text}
      </p>
    </div>
  );
}
