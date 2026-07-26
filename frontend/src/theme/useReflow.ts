import { useLayoutEffect, useRef } from "react";

/** Curta o bastante para não atrasar o gesto, longa o bastante para ser lida. */
const DURACAO_MS = 200;
const SUAVIZACAO = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Faz os blocos DESLIZAREM para a nova posição em vez de saltarem.
 *
 * O CSS Grid não anima reposicionamento: quando um bloco entra numa vaga, os
 * outros trocam de lugar no mesmo quadro, e a tela pisca. Num painel que se
 * reorganiza enquanto se arrasta, esse pisca é o que faz o gesto parecer
 * quebrado — a pessoa não vê PARA ONDE as coisas foram, só que mudaram.
 *
 * A técnica é FLIP: guarda-se onde cada bloco estava, deixa-se o layout
 * acontecer, e anima-se do lugar antigo para o novo com um `transform`. O
 * layout final é sempre o real — a animação é só a viagem até ele, e nada no
 * meio do caminho é posição de verdade.
 *
 * `transform` de propósito, e não `top`/`left`: roda no compositor, sem
 * recalcular layout a cada quadro. Numa grade que se reorganiza a cada célula
 * de arrasto, a diferença aparece.
 */
export function useReflow<T extends HTMLElement>(assinatura: string) {
  const raiz = useRef<T>(null);
  const anterior = useRef(new Map<string, DOMRect>());
  const emCurso = useRef(new Map<string, Animation>());

  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;

    // Quem pediu para não ver movimento não vê. O layout final é o mesmo.
    const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const agora = new Map<string, DOMRect>();
    for (const filho of el.querySelectorAll<HTMLElement>("[data-bloco]")) {
      const id = filho.dataset.bloco;
      if (!id) continue;
      const novo = filho.getBoundingClientRect();
      agora.set(id, novo);

      const velho = anterior.current.get(id);
      if (!velho || quieto) continue;

      const dx = velho.left - novo.left;
      const dy = velho.top - novo.top;
      // Meio pixel de diferença é ruído de arredondamento, não movimento.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      // Uma animação nova substitui a que estava correndo: durante um arrasto,
      // a ordem muda várias vezes por segundo, e deixá-las empilhar faria o
      // bloco perseguir um destino que já mudou.
      emCurso.current.get(id)?.cancel();
      const anim = filho.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: DURACAO_MS, easing: SUAVIZACAO },
      );
      emCurso.current.set(id, anim);
      anim.finished.then(() => emCurso.current.delete(id)).catch(() => {});
    }

    anterior.current = agora;
  }, [assinatura]);

  return raiz;
}
