import { useEffect, useRef, useState } from "react";
import { setGrid } from "@/lib/api";
import {
  ALTURA_MAX,
  ALTURA_MIN,
  COLUNAS,
  LARGURA_MIN,
  LINHA_PX,
  VAO_PX,
  type ThemeBlock,
} from "@/lib/types";
import { linhasOcupadas, mover, redimensionar, type Celula } from "./grade";

/** Que borda foi pega. `mover` é o arrasto pela alça. */
export type Gesto = "mover" | "direita" | "baixo" | "quina";

interface EmCurso {
  id: string;
  gesto: Gesto;
  /** Deslocamento do ponteiro desde que o gesto começou, em pixels. */
  dx: number;
  dy: number;
  /** Onde o bloco estava, em pixels, quando o gesto começou. */
  origemX: number;
  origemY: number;
}

/**
 * O painel arrastável: estado da grade, gestos e as medidas para desenhar.
 *
 * Os blocos são posicionados em `position: absolute` com `transform`, e não
 * pelo CSS Grid. A diferença não é de gosto:
 *
 *   - o bloco arrastado precisa SAIR do fluxo para seguir o cursor. No Grid ele
 *     fica preso à célula e só pula quando a ordem muda, que é o que fazia o
 *     gesto parecer travado;
 *   - com `transform`, os outros blocos deslizam com uma transição de CSS,
 *     de graça. O Grid não anima reposicionamento, e por isso a versão anterior
 *     precisava de FLIP;
 *   - `translate` roda no compositor: numa grade que se recalcula a cada
 *     movimento do ponteiro, isso é a diferença entre fluido e arrastado.
 *
 * O bloco em gesto tem `transition: none` — qualquer suavização entre o cursor
 * e o bloco vira atraso perceptível.
 *
 * Nada aqui reposiciona um bloco que o usuário não pegou. Ver theme/grade.ts
 * para o porquê da escolha.
 */
export function usePainel(blocos: ThemeBlock[], temaId: string, onMudou: () => void) {
  const palco = useRef<HTMLDivElement>(null);
  const [gesto, setGesto] = useState<EmCurso | null>(null);
  // Enquanto se arrasta, a verdade é local: o servidor só é avisado ao soltar.
  const [rascunho, setRascunho] = useState<Celula[] | null>(null);
  const limpar = useRef<(() => void) | null>(null);
  useEffect(() => () => limpar.current?.(), []);

  // Aparado na entrada: o servidor já valida, mas um bloco com x + largura
  // passando de COLUNAS desenharia para fora do palco e a grade de fundo
  // deixaria de bater com os blocos — o defeito apareceria como "a grade está
  // torta", longe da causa.
  const doServidor: Celula[] = blocos.map((b) => {
    const w = Math.max(LARGURA_MIN, Math.min(COLUNAS, b.width));
    return {
      id: b.id,
      w,
      h: Math.max(ALTURA_MIN, Math.min(ALTURA_MAX, b.height)),
      x: Math.max(0, Math.min(COLUNAS - w, b.x)),
      y: Math.max(0, b.y),
    };
  });
  const celulas = rascunho ?? doServidor;
  const porId = new Map(celulas.map((c) => [c.id, c]));

  // O rascunho sobrevive ao soltar e só sai quando o servidor devolve o mesmo
  // arranjo. Limpá-lo antes faria o painel voltar ao estado anterior durante o
  // ida-e-volta da gravação e saltar de novo quando ela chegasse.
  useEffect(() => {
    if (!rascunho || gesto) return;
    const igual = rascunho.every((c) => {
      const b = blocos.find((x) => x.id === c.id);
      return b && b.x === c.x && b.y === c.y && b.width === c.w && b.height === c.h;
    });
    if (igual) setRascunho(null);
  }, [blocos, rascunho, gesto]);

  function larguraDaColuna(): number {
    const l = palco.current?.clientWidth ?? 0;
    return (l - (COLUNAS - 1) * VAO_PX) / COLUNAS;
  }

  /** Onde e de que tamanho um bloco é desenhado, em pixels. */
  function medidas(id: string) {
    const c = porId.get(id);
    const col = larguraDaColuna();
    if (!c) return null;
    // O bloco em arrasto é desenhado a partir de ONDE ELE ESTAVA mais o
    // deslocamento do ponteiro — nunca a partir da célula atual. A célula muda
    // sozinha durante o gesto (a compactação sobe o arranjo), e somar o
    // deslocamento a ela faria o bloco escapulir da mão.
    const arrastando = gesto?.id === id && gesto.gesto === "mover";
    return {
      x: arrastando ? gesto!.origemX + gesto!.dx : c.x * (col + VAO_PX),
      y: arrastando ? gesto!.origemY + gesto!.dy : c.y * (LINHA_PX + VAO_PX),
      w: c.w * col + (c.w - 1) * VAO_PX,
      h: c.h * LINHA_PX + (c.h - 1) * VAO_PX,
      celula: c,
    };
  }

  function comecar(id: string, tipo: Gesto, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Um gesto por vez. Começar outro por cima salvaria o cursor "grabbing"
    // como se fosse o estado normal do documento, e a página ficaria com ele
    // depois de soltar — um resíduo que só some recarregando.
    if (limpar.current) return;
    const inicial = porId.get(id);
    if (!inicial) return;

    const col = larguraDaColuna();
    const passoX = col + VAO_PX;
    const passoY = LINHA_PX + VAO_PX;
    const partida = { x: e.clientX, y: e.clientY };
    const origemX = inicial.x * (col + VAO_PX);
    const origemY = inicial.y * (LINHA_PX + VAO_PX);
    const base = celulas.map((c) => ({ ...c }));
    let ultimo = base;

    const mover_ = (ev: PointerEvent) => {
      const dx = ev.clientX - partida.x;
      const dy = ev.clientY - partida.y;
      const dCol = Math.round(dx / passoX);
      const dLin = Math.round(dy / passoY);

      ultimo =
        tipo === "mover"
          ? mover(base, id, inicial.x + dCol, inicial.y + dLin)
          : redimensionar(
              base,
              id,
              tipo === "baixo" ? inicial.w : inicial.w + dCol,
              tipo === "direita" ? inicial.h : inicial.h + dLin,
            );

      setRascunho(ultimo);
      setGesto({ id, gesto: tipo, dx, dy, origemX, origemY });
    };

    const soltar = async () => {
      limpar.current?.();
      // O que está desenhado no contorno é o que vai para o disco: soltar não
      // corrige, não sobe e não empurra. É o que faz "onde eu larguei" e "onde
      // ficou" serem a mesma coisa.
      const final = ultimo;
      setRascunho(final);
      setGesto(null);
      const mudou = final.some((c) => {
        const b = blocos.find((x) => x.id === c.id);
        return !b || b.x !== c.x || b.y !== c.y || b.width !== c.w || b.height !== c.h;
      });
      if (!mudou) {
        setRascunho(null);
        return;
      }
      await setGrid(
        temaId,
        final.map((c) => ({ id: c.id, x: c.x, y: c.y, width: c.w, height: c.h })),
      );
      onMudou();
    };

    document.addEventListener("pointermove", mover_);
    document.addEventListener("pointerup", soltar);
    document.addEventListener("pointercancel", soltar);
    const selecao = document.body.style.userSelect;
    const cursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      tipo === "mover"
        ? "grabbing"
        : tipo === "direita"
          ? "ew-resize"
          : tipo === "baixo"
            ? "ns-resize"
            : "nwse-resize";

    limpar.current = () => {
      document.removeEventListener("pointermove", mover_);
      document.removeEventListener("pointerup", soltar);
      document.removeEventListener("pointercancel", soltar);
      document.body.style.userSelect = selecao;
      document.body.style.cursor = cursor;
      limpar.current = null;
    };
  }

  /** Teclado: um passo por vez, gravado na hora. */
  async function porTeclado(id: string, d: Partial<Celula>) {
    const c = porId.get(id);
    if (!c) return;
    const novo =
      d.w !== undefined || d.h !== undefined
        ? redimensionar(celulas, id, c.w + (d.w ?? 0), c.h + (d.h ?? 0))
        : mover(celulas, id, c.x + (d.x ?? 0), c.y + (d.y ?? 0));
    setRascunho(novo);
    await setGrid(
      temaId,
      novo.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.w, height: n.h })),
    );
    onMudou();
  }

  const alturaDoPalco = linhasOcupadas(celulas) * (LINHA_PX + VAO_PX);

  return {
    palco,
    medidas,
    comecar,
    porTeclado,
    gesto,
    alturaDoPalco,
    larguraDaColuna,
  };
}
