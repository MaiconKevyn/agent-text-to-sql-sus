/**
 * Paleta de gráfico, validada com `scripts/validate_palette.js` do skill dataviz.
 *
 * O acento da interface (#0c6a7d) REPROVOU no piso de croma como cor de série —
 * funciona como detalhe de UI, mas lido como marca de dado ele acinzenta. O teal
 * abaixo é o passo mais próximo que passa.
 *
 * O tema escuro tem passos próprios, não é o claro invertido: a banda de
 * luminosidade do modo escuro é L 0.48–0.67, mais estreita que a do claro
 * (0.43–0.77), e as cores claras caíam fora dela.
 *
 * Resultado da validação (OKLab ×100):
 *   claro  5 slots — CVD ΔE 9.1 · normal 19.6 · todos ≥ 3:1 de contraste
 *   escuro 5 slots — CVD ΔE 8.4 · normal 19.3 · todos ≥ 3:1 de contraste
 */
export const SERIES = {
  light: ["#0f8ba3", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  dark: ["#1f9fb8", "#d95926", "#199e70", "#c98500", "#d55181"],
} as const;

export interface ChartTheme {
  serie: readonly string[];
  sequencial: readonly string[];
  /** Tokens de texto: rótulo NUNCA usa a cor da série. */
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  grid: string;
  surface: string;
}

const LIGHT: ChartTheme = {
  serie: SERIES.light,
  sequencial: ["#c7e7ef", "#8ecfdf", "#4fb0c8", "#1f92ac", "#0f6f85"],
  ink: "#1b2430",
  inkMuted: "#556274",
  inkSubtle: "#78849a",
  grid: "#e5e9ee",
  surface: "#ffffff",
};

const DARK: ChartTheme = {
  serie: SERIES.dark,
  sequencial: ["#123a45", "#165a6b", "#1a7d92", "#1f9fb8", "#5cc3d4"],
  ink: "#f0f3f7",
  inkMuted: "#a4b0c0",
  inkSubtle: "#7d8a9c",
  grid: "#232d3b",
  surface: "#141a24",
};

export function chartTheme(dark: boolean): ChartTheme {
  return dark ? DARK : LIGHT;
}

/** Formatação de eixo: milhar abreviado, para o rótulo não estourar. */
export function abreviar(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1).replace(".", ",")} bi`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1e3) return `${Math.round(v / 1e3)} mil`;
  return new Intl.NumberFormat("pt-BR").format(v);
}

export const nfBR = new Intl.NumberFormat("pt-BR");
