/**
 * A geometria do painel, em células. Sem React e sem DOM: dado um arranjo e um
 * movimento, sai outro arranjo. É o que permite conferir o comportamento sem
 * arrastar nada.
 *
 * O painel é de POSIÇÃO LIVRE: um bloco fica exatamente onde foi solto, do
 * tamanho que foi deixado, e nenhum outro se mexe por causa dele.
 *
 * Isto é uma escolha, e é o contrário do que Grafana e companhia fazem — lá o
 * arranjo se empacota sozinho: quem é invadido desce, quem fica com buraco
 * embaixo sobe. Empacotar mantém o painel sempre arrumado e cobra por isso:
 * mexer num bloco reposiciona outros, e um espaço deixado de propósito some na
 * primeira compactação.
 *
 * Aqui o arranjo é do usuário. O preço é que dois blocos podem se sobrepor —
 * e desfazer isso é mover um deles à mão.
 */

/* As medidas da grade moram aqui, e não em lib/types, para este módulo não
   depender de nada: é o que permite rodá-lo direto no Node e conferir o
   comportamento sem navegador. `lib/types` reexporta. */
export const COLUNAS = 12;
export const LARGURA_MIN = 3;
export const ALTURA_MIN = 4;
export const ALTURA_MAX = 40;
/** Altura de uma unidade de linha, em pixels, e o vão entre blocos. */
export const LINHA_PX = 30;
export const VAO_PX = 12;

/** Linhas vazias mantidas abaixo do último bloco, para haver onde soltar. */
export const FOLGA_LINHAS = 10;

export interface Celula {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const colide = (a: Celula, b: Celula): boolean =>
  a.id !== b.id &&
  a.x < b.x + b.w &&
  a.x + a.w > b.x &&
  a.y < b.y + b.h &&
  a.y + a.h > b.y;

/**
 * Aparado só para caber na grade: largura entre o mínimo e o total de colunas,
 * altura dentro da faixa, e nada saindo pela esquerda, pela direita ou por
 * cima. Para baixo não há limite — o painel cresce.
 */
export function limitar(c: Celula): Celula {
  const w = Math.max(LARGURA_MIN, Math.min(COLUNAS, Math.round(c.w)));
  return {
    ...c,
    w,
    h: Math.max(ALTURA_MIN, Math.min(ALTURA_MAX, Math.round(c.h))),
    x: Math.max(0, Math.min(COLUNAS - w, Math.round(c.x))),
    y: Math.max(0, Math.round(c.y)),
  };
}

/** Põe `id` em (x, y). Ninguém mais se mexe. */
export function mover(celulas: Celula[], id: string, x: number, y: number): Celula[] {
  return celulas.map((c) => (c.id === id ? limitar({ ...c, x, y }) : c));
}

/** Muda o tamanho de `id`. Ninguém mais se mexe. */
export function redimensionar(celulas: Celula[], id: string, w: number, h: number): Celula[] {
  return celulas.map((c) => (c.id === id ? limitar({ ...c, w, h }) : c));
}

/** Quantas linhas o arranjo ocupa, com folga para soltar abaixo de tudo. */
export const linhasOcupadas = (celulas: Celula[]): number =>
  celulas.reduce((max, c) => Math.max(max, c.y + c.h), 0) + FOLGA_LINHAS;
