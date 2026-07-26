/**
 * Paletas do produto: temas prontos que trocam o cromo E as cores dos gráficos.
 *
 * Trocar só o fundo e a borda seria meia solução. Uma paleta para daltonismo
 * que não alcança as séries do gráfico não serve para nada — é justamente no
 * dado que a cor carrega informação, e é lá que a confusão custa caro. Por isso
 * cada paleta define as duas camadas.
 *
 * As séries NÃO foram escolhidas por gosto. Cada conjunto passou pelo
 * `validate_palette.js` do skill dataviz (banda de luminosidade, piso de croma,
 * separação sob daltonismo, piso de visão normal, contraste com a superfície).
 * Os números medidos estão ao lado de cada uma. Mexer numa cor sem rodar o
 * validador de novo é desfazer o trabalho em silêncio.
 *
 * Duas coisas que a validação ensinou e que valem ficar registradas:
 *
 *   A ORDEM IMPORTA TANTO QUANTO AS CORES. O Okabe-Ito na ordem em que é
 *   publicado dá ΔE 7,6 no pior par adjacente; reordenado, 18. Mesmas cinco
 *   cores.
 *
 *   COR DE EDITOR NÃO É COR DE DADO. As cores literais do Darcula reprovam:
 *   são pensadas para texto sobre fundo escuro, têm croma baixo, e #6A8759
 *   contra #6897BB dá ΔE 13,8 — indistinguível até com visão normal. A paleta
 *   aqui mantém as famílias de matiz do Darcula com croma de dado.
 */

/**
 * Os tokens do tema padrão, os mesmos de index.css.
 *
 * Duplicados aqui de propósito, e o testa_paletas.mjs confere que as duas
 * cópias não divergiram. O CSS é quem pinta antes de o JavaScript rodar — sem
 * ele haveria um lampejo sem tema no carregamento. Estes valores existem porque
 * o gráfico precisa das cores como STRING, e lê-las do CSS durante o render
 * pega a paleta anterior: as variáveis são escritas num efeito, que roda depois.
 */
export const BASE = {
  claro: {
    "--canvas": "210 25% 98%",
    "--surface": "0 0% 100%",
    "--raised": "210 24% 96%",
    "--line": "214 20% 89%",
    "--line-strong": "214 18% 80%",
    "--ink": "215 30% 14%",
    "--ink-muted": "215 16% 40%",
    "--ink-subtle": "215 13% 47%",
    "--accent": "190 82% 27%",
    "--accent-hover": "190 84% 22%",
    "--accent-ink": "0 0% 100%",
    "--accent-soft": "188 60% 95%",
    "--positive": "158 64% 28%",
    "--caution": "32 81% 33%",
    "--caution-soft": "40 90% 95%",
    "--critical": "0 65% 40%",
    "--critical-soft": "0 80% 96%",
    "--shadow": "215 40% 20%",
  },
  escuro: {
    "--canvas": "216 33% 8%",
    "--surface": "216 28% 11%",
    "--raised": "215 25% 15%",
    "--line": "215 20% 21%",
    "--line-strong": "215 18% 30%",
    "--ink": "210 25% 96%",
    "--ink-muted": "215 16% 70%",
    "--ink-subtle": "215 13% 57%",
    "--accent": "187 68% 56%",
    "--accent-hover": "187 72% 66%",
    "--accent-ink": "216 33% 8%",
    "--accent-soft": "190 50% 17%",
    "--positive": "158 55% 55%",
    "--caution": "38 82% 62%",
    "--caution-soft": "36 40% 16%",
    "--critical": "0 70% 66%",
    "--critical-soft": "0 40% 17%",
    "--shadow": "216 60% 3%",
  },
} as const;

/** Um valor de token: componentes HSL, como o resto do sistema ("190 82% 27%"). */
type Tokens = Record<string, string>;

export interface Paleta {
  id: string;
  nome: string;
  /** Uma linha, mostrada abaixo do nome no seletor. */
  descricao: string;
  /** Quando a paleta só faz sentido num modo — o Darcula é escuro por natureza. */
  fixo?: "light" | "dark";
  claro?: Tokens;
  escuro?: Tokens;
  serie: { claro: readonly string[]; escuro: readonly string[] };
  sequencial: { claro: readonly string[]; escuro: readonly string[] };
}

/* Os tokens do tema padrão vivem em index.css e continuam sendo o ponto de
   partida: uma paleta só declara o que muda. Assim, um token novo no CSS não
   precisa ser repetido em toda paleta. */
const PADRAO_SERIE_CLARO = ["#0f8ba3", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
const PADRAO_SERIE_ESCURO = ["#1f9fb8", "#d95926", "#199e70", "#c98500", "#d55181"] as const;

export const PALETAS: Paleta[] = [
  {
    id: "padrao",
    nome: "Padrão",
    descricao: "Azul-petróleo sobre neutros frios",
    // Sem overrides: é o que está em index.css.
    serie: { claro: PADRAO_SERIE_CLARO, escuro: PADRAO_SERIE_ESCURO },
    sequencial: {
      claro: ["#c7e7ef", "#8ecfdf", "#4fb0c8", "#1f92ac", "#0f6f85"],
      escuro: ["#123a45", "#165a6b", "#1a7d92", "#1f9fb8", "#5cc3d4"],
    },
  },

  {
    id: "argila",
    nome: "Argila",
    descricao: "Creme e terracota, inspirado no Claude",
    claro: {
      "--canvas": "40 33% 95%",
      "--surface": "42 45% 98%",
      "--raised": "40 28% 92%",
      "--line": "36 20% 85%",
      "--line-strong": "34 18% 74%",
      "--ink": "24 22% 15%",
      "--ink-muted": "26 14% 38%",
      "--ink-subtle": "28 12% 44%",
      "--accent": "16 52% 40%",
      "--accent-hover": "16 56% 33%",
      "--accent-ink": "42 45% 98%",
      "--accent-soft": "26 60% 92%",
      "--caution-soft": "38 70% 91%",
      "--shadow": "26 35% 22%",
    },
    escuro: {
      "--canvas": "26 14% 10%",
      "--surface": "26 12% 13%",
      "--raised": "26 11% 18%",
      "--line": "26 10% 24%",
      "--line-strong": "26 10% 34%",
      "--ink": "38 30% 94%",
      "--ink-muted": "32 12% 70%",
      "--ink-subtle": "30 10% 56%",
      "--accent": "18 65% 62%",
      "--accent-hover": "18 70% 70%",
      "--accent-ink": "26 14% 10%",
      "--accent-soft": "18 30% 20%",
      "--caution-soft": "34 30% 18%",
      "--shadow": "26 40% 3%",
    },
    // claro: CVD ΔE 10,0 · normal 15,7 — argila na primeira posição, que é a
    // que aparece quando o gráfico tem uma série só.
    serie: {
      claro: ["#C2603C", "#2A6DA8", "#0E8F6E", "#4FA3D9", "#C46B96"],
      escuro: ["#D9784F", "#4B8FC9", "#1FA882", "#6FB8E6", "#D486AC"],
    },
    sequencial: {
      claro: ["#f3ddd0", "#e5b79c", "#d4906b", "#c2603c", "#8f4227"],
      escuro: ["#3d1f13", "#5e3320", "#8a4a2c", "#c2603c", "#e0946f"],
    },
  },

  {
    id: "daltonismo",
    nome: "Daltonismo",
    descricao: "Okabe-Ito reordenado — separação máxima sob deutan e protan",
    claro: {
      "--accent": "202 100% 26%",
      "--accent-hover": "202 100% 20%",
      "--accent-soft": "202 60% 93%",
    },
    escuro: {
      "--accent": "202 87% 62%",
      "--accent-hover": "202 90% 72%",
      "--accent-soft": "202 45% 18%",
    },
    // claro: CVD ΔE 18,0 · normal 18,7 — contra 7,6 na ordem publicada.
    serie: {
      claro: ["#009E73", "#0072B2", "#56B4E9", "#E69F00", "#CC79A7"],
      escuro: ["#1FBF8F", "#3E96D1", "#7BC8F0", "#F0B429", "#DE93BC"],
    },
    sequencial: {
      claro: ["#d8ecf7", "#a9d3ec", "#6fb4dc", "#3a8fc4", "#0072B2"],
      escuro: ["#0b2c42", "#12466a", "#1a6394", "#2f86c0", "#7BC8F0"],
    },
  },

  {
    id: "darcula",
    nome: "Darcula",
    descricao: "Cinzas quentes do VS Code, com croma de dado",
    fixo: "dark",
    escuro: {
      "--canvas": "0 0% 15%",
      "--surface": "220 4% 22%",
      "--raised": "220 4% 27%",
      "--line": "220 4% 32%",
      "--line-strong": "220 4% 42%",
      "--ink": "220 12% 88%",
      "--ink-muted": "220 9% 74%",
      "--ink-subtle": "220 8% 65%",
      "--accent": "30 62% 58%",
      "--accent-hover": "30 70% 66%",
      "--accent-ink": "0 0% 15%",
      "--accent-soft": "30 25% 22%",
      "--positive": "88 30% 55%",
      "--caution": "36 70% 62%",
      "--caution-soft": "36 22% 22%",
      "--critical": "5 60% 60%",
      "--critical-soft": "5 25% 22%",
      "--shadow": "0 0% 3%",
    },
    // escuro: CVD ΔE 20,2 · normal 20,3.
    serie: {
      claro: ["#C4762F", "#A46FBD", "#B08A22", "#3E8FCC", "#66A343"],
      escuro: ["#C4762F", "#A46FBD", "#B08A22", "#3E8FCC", "#66A343"],
    },
    sequencial: {
      claro: ["#3a2a17", "#5c4322", "#875f28", "#b0802f", "#d6a552"],
      escuro: ["#3a2a17", "#5c4322", "#875f28", "#b0802f", "#d6a552"],
    },
  },

  {
    id: "contraste",
    nome: "Alto contraste",
    descricao: "Preto e branco puros, para leitura difícil",
    claro: {
      "--canvas": "0 0% 100%",
      "--surface": "0 0% 100%",
      "--raised": "0 0% 94%",
      "--line": "0 0% 45%",
      "--line-strong": "0 0% 20%",
      "--ink": "0 0% 0%",
      "--ink-muted": "0 0% 22%",
      "--ink-subtle": "0 0% 34%",
      "--accent": "222 100% 34%",
      "--accent-hover": "222 100% 26%",
      "--accent-soft": "222 100% 94%",
      "--shadow": "0 0% 0%",
    },
    escuro: {
      "--canvas": "0 0% 0%",
      "--surface": "0 0% 5%",
      "--raised": "0 0% 12%",
      "--line": "0 0% 55%",
      "--line-strong": "0 0% 75%",
      "--ink": "0 0% 100%",
      "--ink-muted": "0 0% 82%",
      "--ink-subtle": "0 0% 68%",
      "--accent": "205 100% 70%",
      "--accent-hover": "205 100% 80%",
      "--accent-ink": "0 0% 0%",
      "--accent-soft": "205 60% 16%",
      "--shadow": "0 0% 0%",
    },
    // Mesmos passos do Okabe-Ito: alto contraste é sobre legibilidade, e essa
    // paleta é a que mais separa.
    serie: {
      claro: ["#009E73", "#0072B2", "#56B4E9", "#E69F00", "#CC79A7"],
      escuro: ["#1FBF8F", "#3E96D1", "#7BC8F0", "#F0B429", "#DE93BC"],
    },
    sequencial: {
      claro: ["#e8e8e8", "#bdbdbd", "#8a8a8a", "#525252", "#1a1a1a"],
      escuro: ["#1a1a1a", "#4d4d4d", "#808080", "#b3b3b3", "#f0f0f0"],
    },
  },
];

export const PALETA_PADRAO = "padrao";

export const acharPaleta = (id: string): Paleta =>
  PALETAS.find((p) => p.id === id) ?? PALETAS[0];

/**
 * Escreve os tokens da paleta no elemento — no `<html>` para valer no site
 * inteiro, ou num contêiner para valer só ali.
 *
 * Limpa os tokens da paleta anterior antes de escrever: sem isso, trocar de uma
 * paleta que redefine `--positive` para outra que não redefine deixaria o valor
 * antigo grudado, e o resultado seria uma mistura que nenhuma das duas
 * descreve.
 */
export function aplicarPaleta(el: HTMLElement, id: string, modo: "light" | "dark"): void {
  const anteriores = el.dataset.tokensPaleta;
  if (anteriores) for (const t of anteriores.split(",")) el.style.removeProperty(t);

  const paleta = acharPaleta(id);
  const tokens = (modo === "dark" ? paleta.escuro : paleta.claro) ?? {};
  for (const [k, v] of Object.entries(tokens)) el.style.setProperty(k, v);

  el.dataset.tokensPaleta = Object.keys(tokens).join(",");
  el.dataset.paleta = id;
}

/** Tira os tokens de paleta do elemento, devolvendo-o ao que herdar do site. */
export function limparPaleta(el: HTMLElement): void {
  const anteriores = el.dataset.tokensPaleta;
  if (anteriores) for (const t of anteriores.split(",")) el.style.removeProperty(t);
  delete el.dataset.tokensPaleta;
  delete el.dataset.paleta;
}
