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
import { acharPaleta, BASE, PALETA_PADRAO, type Paleta } from "./paletas";

export interface ChartTheme {
  serie: readonly string[];
  sequencial: readonly string[];
  /** Tokens de texto: rótulo NUNCA usa a cor da série. */
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  line: string;
  surface: string;
  /** Faixas alternadas do heatmap: sem isto o ECharts usa branco por padrão. */
  raised: string;
}

/**
 * Resolve um token da paleta ativa, com o tema padrão como base.
 *
 * Em JavaScript e não lendo o CSS: as variáveis são escritas num efeito, que
 * roda DEPOIS do render — e `montaOpcao` roda durante. Lendo do CSS, o gráfico
 * ficava sempre uma paleta atrás: trocar para a paleta creme deixava o eixo com
 * o cinza-frio da anterior.
 */
function token(paleta: Paleta, modo: "claro" | "escuro", nome: string): string {
  const escolhido = (modo === "escuro" ? paleta.escuro : paleta.claro)?.[nome];
  return `hsl(${escolhido ?? BASE[modo][nome as keyof (typeof BASE)["claro"]]})`;
}

export function chartTheme(dark: boolean, paletaId = PALETA_PADRAO): ChartTheme {
  const p = acharPaleta(paletaId);
  const modo = dark ? "escuro" : "claro";
  return {
    serie: p.serie[modo],
    sequencial: p.sequencial[modo],
    ink: token(p, modo, "--ink"),
    inkMuted: token(p, modo, "--ink-muted"),
    inkSubtle: token(p, modo, "--ink-subtle"),
    line: token(p, modo, "--line"),
    surface: token(p, modo, "--surface"),
    raised: token(p, modo, "--raised"),
  };
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
