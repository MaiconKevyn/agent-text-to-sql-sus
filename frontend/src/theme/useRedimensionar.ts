import { useEffect, useRef, useState } from "react";
import { layoutBlock } from "@/lib/api";
import {
  ALTURA_MAX,
  ALTURA_MIN,
  COLUNAS,
  LARGURA_MIN,
  LINHA_PX,
  VAO_PX,
  type ThemeBlock,
} from "@/lib/types";

/** Que borda foi pega. A quina muda as duas dimensões ao mesmo tempo. */
export type Borda = "direita" | "baixo" | "quina";

export interface Tamanho {
  width: number;
  height: number;
}

const limita = (t: Tamanho): Tamanho => ({
  width: Math.max(LARGURA_MIN, Math.min(COLUNAS, t.width)),
  height: Math.max(ALTURA_MIN, Math.min(ALTURA_MAX, t.height)),
});

/**
 * Redimensionar um bloco puxando a borda.
 *
 * Substituiu três tamanhos fixos (p/m/g). O gesto de painel é pegar a quina e
 * arrastar; três degraus não respondem a "um pouco mais largo", e um botão que
 * só aparece no hover ninguém acha.
 *
 * O tamanho é em CÉLULAS, não em pixels: largura de 1 a 12 colunas, altura em
 * unidades de linha. Guardar pixels amarraria o painel à largura da janela em
 * que foi arrumado — a mesma investigação aberta num monitor menor viria com os
 * blocos estourando para fora.
 *
 * Os listeners sobem no próprio pointerdown, pelo mesmo motivo que em
 * useReordenar: um efeito disparado por estado só corre depois do commit, e um
 * arrasto rápido termina antes disso.
 */
export function useRedimensionar(blocos: ThemeBlock[], temaId: string, onMudou: () => void) {
  // Enquanto se arrasta, o tamanho da tela sai daqui e não do servidor.
  const [previa, setPrevia] = useState<{ id: string; t: Tamanho } | null>(null);

  // A prévia sobrevive ao soltar, e só sai quando o servidor devolve o mesmo
  // valor. Limpá-la ao soltar faria o bloco voltar ao tamanho antigo durante o
  // ida-e-volta da gravação e saltar de novo quando ela chegasse — uma piscada
  // no fim de todo redimensionamento.
  useEffect(() => {
    if (!previa) return;
    const b = blocos.find((x) => x.id === previa.id);
    if (b && b.width === previa.t.width && b.height === previa.t.height) setPrevia(null);
  }, [blocos, previa]);
  const limpar = useRef<(() => void) | null>(null);
  useEffect(() => () => limpar.current?.(), []);

  /** O tamanho a desenhar: a prévia do arrasto em curso, ou o que veio salvo. */
  function tamanhoDe(b: ThemeBlock): Tamanho {
    return previa?.id === b.id ? previa.t : limita({ width: b.width, height: b.height });
  }

  function aoPegarBorda(bloco: ThemeBlock, borda: Borda, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();

    const grade = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-grade]");
    if (!grade) return;

    // Largura de uma coluna, medida da grade real: depende da janela, e uma
    // constante aqui erraria em qualquer tela que não fosse a do desenvolvedor.
    const colunaPx = (grade.clientWidth - (COLUNAS - 1) * VAO_PX) / COLUNAS;
    const inicio = { x: e.clientX, y: e.clientY };
    const original = limita({ width: bloco.width, height: bloco.height });
    let ultimo = original;

    const mover = (ev: PointerEvent) => {
      const dCol = Math.round((ev.clientX - inicio.x) / (colunaPx + VAO_PX));
      const dLin = Math.round((ev.clientY - inicio.y) / (LINHA_PX + VAO_PX));
      ultimo = limita({
        width: borda === "baixo" ? original.width : original.width + dCol,
        height: borda === "direita" ? original.height : original.height + dLin,
      });
      setPrevia({ id: bloco.id, t: ultimo });
    };

    const soltar = async () => {
      limpar.current?.();
      if (ultimo.width === original.width && ultimo.height === original.height) {
        setPrevia(null);
        return;
      }
      await layoutBlock(temaId, bloco.id, ultimo);
      onMudou();
    };

    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", soltar);
    document.addEventListener("pointercancel", soltar);
    const selecaoAntes = document.body.style.userSelect;
    const cursorAntes = document.body.style.cursor;
    document.body.style.userSelect = "none";
    // O cursor fica no corpo inteiro: durante o arrasto o ponteiro sai de cima
    // da alça, e sem isto ele volta a ser seta no meio do gesto.
    document.body.style.cursor =
      borda === "direita" ? "ew-resize" : borda === "baixo" ? "ns-resize" : "nwse-resize";

    limpar.current = () => {
      document.removeEventListener("pointermove", mover);
      document.removeEventListener("pointerup", soltar);
      document.removeEventListener("pointercancel", soltar);
      document.body.style.userSelect = selecaoAntes;
      document.body.style.cursor = cursorAntes;
      limpar.current = null;
    };
  }

  /** Teclado: as setas mudam o tamanho uma célula por vez. */
  async function aoAjustar(bloco: ThemeBlock, d: Partial<Tamanho>) {
    const novo = limita({
      width: bloco.width + (d.width ?? 0),
      height: bloco.height + (d.height ?? 0),
    });
    if (novo.width === bloco.width && novo.height === bloco.height) return;
    await layoutBlock(temaId, bloco.id, novo);
    onMudou();
  }

  return { tamanhoDe, aoPegarBorda, aoAjustar, redimensionando: previa?.id ?? null };
}
