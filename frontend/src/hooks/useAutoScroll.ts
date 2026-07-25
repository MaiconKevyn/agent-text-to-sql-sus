import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mantém o container colado no fim enquanto a resposta chega, mas para de
 * forçar assim que o usuário rola para cima — e avisa disso para a UI poder
 * oferecer o botão "voltar ao fim".
 */
export function useAutoScroll<T extends HTMLElement>(deps: unknown[], enabled = true) {
  const ref = useRef<T | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const grudado = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = ref.current;
    if (!el) return;
    grudado.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
      const perto = distancia < 80;
      grudado.current = perto;
      setAtBottom(perto);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Sem conversa não há para onde rolar: a tela inicial deve começar no topo.
    if (!enabled) return;
    if (grudado.current) ref.current?.scrollTo({ top: ref.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return { ref, atBottom, scrollToBottom };
}
