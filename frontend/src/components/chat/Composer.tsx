import { BookOpen, ArrowUp, Square } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";

const ALTURA_MAX = 200;

export interface ComposerHandle {
  /** Acrescenta texto no fim do campo e devolve o foco. */
  append: (texto: string) => void;
  focus: () => void;
}

interface ComposerProps {
  busy: boolean;
  onSend: (texto: string) => void;
  onStop: () => void;
  /** Abre o painel que mostra o que um termo significa nesta base. */
  onDefineTerm?: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  ({ busy, onSend, onStop, onDefineTerm }, ref) => {
    const [valor, setValor] = useState("");
    const area = useRef<HTMLTextAreaElement>(null);

    // Auto-resize até um teto, depois rola dentro do próprio campo.
    // A medição precisa acontecer com a barra de rolagem escondida e a altura
    // liberada, senão `scrollHeight` devolve a altura já aplicada em vez da
    // altura do conteúdo.
    const ajustarAltura = useCallback(() => {
      const el = area.current;
      if (!el) return;
      el.style.overflowY = "hidden";
      el.style.height = "auto";
      const conteudo = el.scrollHeight;
      const altura = Math.min(conteudo, ALTURA_MAX);
      el.style.height = `${altura}px`;
      el.style.overflowY = conteudo > ALTURA_MAX ? "auto" : "hidden";
    }, []);

    useLayoutEffect(ajustarAltura, [valor, ajustarAltura]);

    // A primeira medição pode cair antes de a folha de estilo e as fontes
    // chegarem — em dev o Vite injeta o CSS depois do primeiro layout. Um
    // ResizeObserver na largura do campo cobre os três casos de uma vez:
    // CSS tardio, fonte tardia e redimensionamento da janela.
    useLayoutEffect(() => {
      const el = area.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      let largura = el.clientWidth;
      const ro = new ResizeObserver(() => {
        if (el.clientWidth === largura) return;
        largura = el.clientWidth;
        ajustarAltura();
      });
      ro.observe(el);
      void document.fonts?.ready.then(ajustarAltura);
      return () => ro.disconnect();
    }, [ajustarAltura]);

    useImperativeHandle(ref, () => ({
      append: (texto) => {
        setValor((v) => (v ? `${v.trimEnd()} ${texto}` : texto));
        area.current?.focus();
      },
      focus: () => area.current?.focus(),
    }));

    function enviar() {
      const t = valor.trim();
      if (!t || busy) return;
      onSend(t);
      setValor("");
    }

    return (
      <div className="rounded-2xl border border-line bg-surface shadow-raised transition-shadow duration-200 focus-within:border-line-strong focus-within:shadow-panel">
        <label htmlFor="composer" className="sr-only">
          Escreva sua pergunta sobre as internações do SUS
        </label>
        <textarea
          id="composer"
          ref={area}
          rows={1}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder="Pergunte sobre internações, custos, diagnósticos, mortalidade…"
          className="scroll-thin block w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle"
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
          <p className="select-none text-[11px] text-ink-subtle">
            <kbd className="rounded border border-line bg-raised px-1 py-px font-sans text-[10px]">
              Enter
            </kbd>{" "}
            envia ·{" "}
            <kbd className="rounded border border-line bg-raised px-1 py-px font-sans text-[10px]">
              Shift+Enter
            </kbd>{" "}
            quebra linha
          </p>
          <div className="flex items-center gap-2">
            {onDefineTerm && (
              <button
                type="button"
                onClick={onDefineTerm}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
              >
                <BookOpen aria-hidden className="h-3.5 w-3.5" />
                Definir um termo
              </button>
            )}
          {busy ? (
            <Button size="icon" variant="outline" onClick={onStop} aria-label="Parar geração">
              <Square aria-hidden className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="primary"
              onClick={enviar}
              disabled={!valor.trim()}
              aria-label="Enviar pergunta"
            >
              <ArrowUp aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          )}
          </div>
        </div>
      </div>
    );
  },
);
Composer.displayName = "Composer";
