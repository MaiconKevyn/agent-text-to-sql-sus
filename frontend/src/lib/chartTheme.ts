/**
 * Tema dos gráficos do produto.
 *
 * Os passos vieram do `validate_palette.js` do skill dataviz e passam nos seis
 * testes nos dois modos. Duas coisas foram descobertas na validação e não devem
 * ser desfeitas sem rodar o script de novo:
 *
 *  - o acento da interface (#0c6a7d) REPROVA no piso de croma como cor de
 *    série: como marca de dado ele acinzenta. O teal abaixo é o passo mais
 *    próximo que passa;
 *  - o modo escuro tem passos próprios, não é o claro invertido — sua banda de
 *    luminosidade (L 0.48–0.67) é mais estreita que a do claro (0.43–0.77).
 *
 * Resultado (OKLab ×100): claro CVD ΔE 9.1 · normal 19.6; escuro 8.4 · 19.3.
 */
export interface ChartTheme {
  serie: readonly string[];
  sequencial: readonly string[];
  /** Tokens de texto: rótulo NUNCA usa a cor da série. */
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  line: string;
  surface: string;
}

const LIGHT: ChartTheme = {
  serie: ["#0f8ba3", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  sequencial: ["#c7e7ef", "#8ecfdf", "#4fb0c8", "#1f92ac", "#0f6f85"],
  ink: "#1b2430",
  inkMuted: "#556274",
  inkSubtle: "#78849a",
  line: "#e5e9ee",
  surface: "#ffffff",
};

const DARK: ChartTheme = {
  serie: ["#1f9fb8", "#d95926", "#199e70", "#c98500", "#d55181"],
  sequencial: ["#123a45", "#165a6b", "#1a7d92", "#1f9fb8", "#5cc3d4"],
  ink: "#f0f3f7",
  inkMuted: "#a4b0c0",
  inkSubtle: "#7d8a9c",
  line: "#232d3b",
  surface: "#141a24",
};

export function chartTheme(dark: boolean): ChartTheme {
  return dark ? DARK : LIGHT;
}

export const nfBR = new Intl.NumberFormat("pt-BR");

/**
 * Eixo em milhar abreviado, para o rótulo não estourar a margem.
 *
 * A casa decimal abaixo de 100 mil não é enfeite: sem ela, 7.513 virava
 * "8 mil" e três barras de 4.441, 3.761 e 3.712 apareciam todas como "4 mil" —
 * o rótulo direto contradizia o comprimento da barra.
 */
export function abreviar(v: number): string {
  const abs = Math.abs(v);
  const vg = (n: number, casas: number) => n.toFixed(casas).replace(".", ",");
  if (abs >= 1e9) return `${vg(v / 1e9, 1)} bi`;
  if (abs >= 1e6) return `${vg(v / 1e6, 1)} mi`;
  if (abs >= 1e5) return `${Math.round(v / 1e3)} mil`;
  if (abs >= 1e3) return `${vg(v / 1e3, 1)} mil`;
  if (!Number.isInteger(v)) return vg(v, 2);
  return nfBR.format(v);
}
