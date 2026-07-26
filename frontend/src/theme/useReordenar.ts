import { useEffect, useRef, useState } from "react";
import { reorderBlocks } from "@/lib/api";
import type { ThemeBlock } from "@/lib/types";

/**
 * Arrastar para reordenar os blocos do painel.
 *
 * A ordem de fixação é cronológica, e num painel isso é a ordem errada quase
 * sempre: o indicador que resume a investigação foi fixado no meio dela, e o
 * primeiro bloco costuma ser a pergunta que abriu o assunto, não a que o
 * responde. Sem isto, mudar de ideia sobre o arranjo é desfixar e fixar de novo.
 *
 * Eventos de ponteiro, não o drag-and-drop do HTML5. O DnD nativo não existe no
 * toque — num tablet o painel simplesmente não reordenaria — e ainda depende de
 * um `dataTransfer` que aqui não carrega nada: o que se arrasta é um id que já
 * está na tela. Ponteiro cobre mouse, caneta e dedo com o mesmo código.
 *
 * A lista se reorganiza durante o arrasto, não ao soltar: quem arrasta precisa
 * ver onde o bloco vai cair enquanto ainda dá para desistir. O servidor é
 * chamado uma vez só, no fim.
 */
export function useReordenar(blocos: ThemeBlock[], temaId: string, onMudou: () => void) {
  const idsDoServidor = blocos.map((b) => b.id).join(",");
  const [ordem, setOrdem] = useState<string[]>(() => blocos.map((b) => b.id));
  const [arrastando, setArrastando] = useState<string | null>(null);
  const mexeu = useRef(false);
  // A ordem final é lida daqui, e não do fechamento do handler. O efeito corre
  // depois do commit, então na hora de soltar já está atualizada — e ler assim
  // evita pôr o envio dentro do updater do setState, que o StrictMode invoca
  // duas vezes.
  const ordemAtual = useRef(ordem);
  useEffect(() => {
    ordemAtual.current = ordem;
  }, [ordem]);

  // Fixar, remover ou recarregar muda a lista por baixo. Só reacompanha quando
  // o CONJUNTO muda — reacompanhar a cada render desfaria o arrasto em curso.
  useEffect(() => {
    setOrdem(idsDoServidor ? idsDoServidor.split(",") : []);
  }, [idsDoServidor]);

  /** Os blocos na ordem da tela; o que o servidor mandou a mais entra no fim. */
  const ordenados = [
    ...(ordem.map((id) => blocos.find((b) => b.id === id)).filter(Boolean) as ThemeBlock[]),
    ...blocos.filter((b) => !ordem.includes(b.id)),
  ];

  /**
   * Move `origem` para a posição de `alvo`.
   *
   * O ref é atualizado ANTES do estado, e é dele que a gravação lê. Um
   * `pointerup` pode cair no mesmo tick do último `pointermove`, e aí o estado
   * do React ainda não fez o commit — gravar a partir dele mandaria ao servidor
   * a ordem anterior ao último passo do arrasto.
   */
  function trocar(origem: string, alvo: string) {
    if (origem === alvo) return;
    const atual = ordemAtual.current;
    const de = atual.indexOf(origem);
    const para = atual.indexOf(alvo);
    if (de < 0 || para < 0) return;
    const nova = [...atual];
    nova.splice(para, 0, ...nova.splice(de, 1));
    ordemAtual.current = nova;
    setOrdem(nova);
    mexeu.current = true;
  }

  async function gravar() {
    if (!mexeu.current) return; // arrasto que voltou ao lugar não é mudança
    mexeu.current = false;
    await reorderBlocks(temaId, ordemAtual.current);
    onMudou();
  }

  const soltarTudo = useRef<(() => void) | null>(null);
  useEffect(() => () => soltarTudo.current?.(), []);

  /**
   * Começa o arrasto. Os listeners sobem AQUI, não num efeito.
   *
   * Depender de um efeito disparado por estado perde eventos: o React só faz o
   * commit depois, e um arrasto rápido já terminou até lá. Foi exatamente o que
   * aconteceu no primeiro teste — `pointerdown`, dois `pointermove` e `pointerup`
   * chegaram antes de os listeners existirem, e o bloco não saiu do lugar.
   *
   * O `arrastando` do estado serve só para o bloco desbotar enquanto se move.
   */
  function aoPegar(id: string) {
    mexeu.current = false;
    setArrastando(id);

    // No documento, e não no bloco: o ponteiro sai do bloco de origem no
    // primeiro pixel do arrasto, e ouvir só nele perderia o resto.
    const mover = (e: PointerEvent) => {
      const alvo = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-bloco]");
      if (alvo?.dataset.bloco) trocar(id, alvo.dataset.bloco);
    };
    const soltar = () => {
      soltarTudo.current?.();
      setArrastando(null);
      void gravar();
    };

    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", soltar);
    document.addEventListener("pointercancel", soltar);
    // Sem isto o arrasto seleciona o texto dos blocos por onde passa.
    const selecaoAntes = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    soltarTudo.current = () => {
      document.removeEventListener("pointermove", mover);
      document.removeEventListener("pointerup", soltar);
      document.removeEventListener("pointercancel", soltar);
      document.body.style.userSelect = selecaoAntes;
      soltarTudo.current = null;
    };
  }

  /**
   * Move um bloco uma posição, pelo teclado.
   *
   * Arrastar precisa de um ponteiro. Sem isto, quem navega por teclado não
   * reordena o painel de jeito nenhum. Grava na hora porque, ao contrário do
   * arrasto, cada passo já é a decisão inteira.
   */
  async function aoMover(id: string, passo: -1 | 1) {
    const de = ordemAtual.current.indexOf(id);
    const para = de + passo;
    if (de < 0 || para < 0 || para >= ordemAtual.current.length) return;
    const nova = [...ordemAtual.current];
    nova.splice(para, 0, ...nova.splice(de, 1));
    setOrdem(nova);
    ordemAtual.current = nova;
    await reorderBlocks(temaId, nova);
    onMudou();
  }

  return { ordenados, arrastando, aoPegar, aoMover };
}
