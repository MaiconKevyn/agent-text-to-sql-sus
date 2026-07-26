
/**
 * A geometria do painel, em células. Sem React e sem DOM: dado um arranjo e um
 * movimento, sai outro arranjo. É o que permite conferir o comportamento sem
 * arrastar nada.
 *
 * O modelo é o mesmo que as dashboards profissionais usam (Grafana, Metabase e
 * companhia, todas sobre react-grid-layout): cada bloco tem x, y, largura e
 * altura EXPLÍCITOS em células. A alternativa — deixar o CSS Grid posicionar
 * pela ordem da lista — foi o que existia aqui antes, e ela impede duas coisas
 * que um painel precisa: deixar um bloco onde ele foi solto (mesmo com espaço
 * vazio ao lado) e mostrar a vaga de destino antes de largar.
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

const limita = (c: Celula): Celula => {
  const w = Math.max(LARGURA_MIN, Math.min(COLUNAS, c.w));
  return {
    ...c,
    w,
    h: Math.max(ALTURA_MIN, Math.min(ALTURA_MAX, c.h)),
    x: Math.max(0, Math.min(COLUNAS - w, c.x)),
    y: Math.max(0, c.y),
  };
};

/**
 * Sobe todo mundo o quanto der, sem trocar a ordem vertical.
 *
 * Sem isto, mover um bloco para longe deixa um buraco permanente no meio do
 * painel — e depois de meia dúzia de ajustes o painel é mais buraco que
 * conteúdo. A compactação é o que faz o arranjo parecer arrumado sozinho.
 *
 * `fixo` é o bloco que está sob o cursor: ele não sobe, senão foge do ponteiro
 * no meio do gesto.
 */
export function compactar(celulas: Celula[], fixo?: string): Celula[] {
  const ordenadas = [...celulas].sort((a, b) => a.y - b.y || a.x - b.x);
  const prontas: Celula[] = [];
  for (const original of ordenadas) {
    const c = { ...original };
    if (c.id !== fixo) {
      while (c.y > 0 && !prontas.some((p) => colide({ ...c, y: c.y - 1 }, p))) c.y--;
    }
    while (prontas.some((p) => colide(c, p))) c.y++;
    prontas.push(c);
  }
  return prontas;
}

/**
 * Põe `id` em (x, y) e empurra para baixo quem estiver na vaga.
 *
 * Empurrar para baixo, e nunca para o lado: mover na horizontal faria os
 * vizinhos trocarem de coluna a cada pixel do arrasto, e o painel ficaria
 * fervilhando. Descer é previsível — dá para ver quem cedeu lugar.
 */
export function mover(celulas: Celula[], id: string, x: number, y: number): Celula[] {
  const alvo = celulas.find((c) => c.id === id);
  if (!alvo) return celulas;
  const fixo = limita({ ...alvo, x, y });
  const outros = celulas.filter((c) => c.id !== id).map((c) => ({ ...c }));

  // Cascata: quem desce pode esbarrar num terceiro. O limite de voltas existe
  // só para que um arranjo estranho não vire laço infinito na tela.
  for (let volta = 0; volta < 50; volta++) {
    let mexeu = false;
    for (const o of outros) {
      if (colide(o, fixo)) {
        o.y = fixo.y + fixo.h;
        mexeu = true;
      }
      for (const p of outros) {
        if (o !== p && colide(o, p) && o.y >= p.y) {
          o.y = p.y + p.h;
          mexeu = true;
        }
      }
    }
    if (!mexeu) break;
  }
  return compactar([fixo, ...outros], id);
}

/** Redimensiona e resolve o que a nova área invadiu. */
export function redimensionar(
  celulas: Celula[],
  id: string,
  w: number,
  h: number,
): Celula[] {
  const alvo = celulas.find((c) => c.id === id);
  if (!alvo) return celulas;
  return mover(
    celulas.map((c) => (c.id === id ? limita({ ...c, w, h }) : c)),
    id,
    alvo.x,
    alvo.y,
  );
}

/** Quantas linhas o arranjo ocupa. Define a altura do palco. */
export const linhasOcupadas = (celulas: Celula[]): number =>
  celulas.reduce((max, c) => Math.max(max, c.y + c.h), 0);
