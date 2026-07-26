/**
 * Confere o contraste do cromo de cada paleta.
 *
 *   node --experimental-strip-types frontend/scripts/testa_paletas.mjs
 *
 * As cores das SÉRIES já passam pelo validate_palette.js do skill dataviz —
 * os números estão anotados em lib/paletas.ts. O que falta é o resto da tela:
 * texto sobre superfície, texto secundário, o acento em botão. Uma paleta bonita
 * com `ink-subtle` a 3:1 é uma paleta que ninguém consegue ler, e isso não
 * aparece em nenhum screenshot de tema claro.
 *
 * Os pisos são os da WCAG 2.1: 4.5:1 para texto normal, 3:1 para texto grande e
 * para limites de componentes.
 */
import { readFileSync } from "node:fs";
import { BASE, PALETAS } from "../src/lib/paletas.ts";

/* BASE está duplicado em paletas.ts e em index.css — um para o JavaScript, o
   outro para pintar antes de o JavaScript rodar. Divergir é fácil e o sintoma é
   sutil: o gráfico com o cinza de uma paleta e a tela com o de outra. */
function doCss() {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const bloco = (ini, fim) => css.slice(css.indexOf(ini), css.indexOf(fim));
  const ler = (txt) =>
    Object.fromEntries(
      [...txt.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.split("/*")[0].trim()]),
    );
  return { light: ler(bloco(":root {", ".dark {")), dark: ler(bloco(".dark {", "* {")) };
}

const doArquivo = doCss();
let divergiu = 0;
for (const [modoJs, modoCss] of [["claro", "light"], ["escuro", "dark"]]) {
  for (const [k, v] of Object.entries(BASE[modoJs])) {
    if (doArquivo[modoCss][k] !== v) {
      console.log(`FALHA BASE.${modoJs} ${k}: paletas.ts "${v}" != index.css "${doArquivo[modoCss][k]}"`);
      divergiu++;
    }
  }
}
console.log(divergiu ? "" : "ok    BASE bate com index.css");

const REF = {
  light: {
    "--canvas": "210 25% 98%",
    "--surface": "0 0% 100%",
    "--raised": "210 24% 96%",
    "--line": "214 20% 89%",
    "--line-strong": "214 18% 80%",
    "--ink": "215 30% 14%",
    "--ink-muted": "215 16% 40%",
    "--ink-subtle": "215 13% 47%",
    "--accent": "190 82% 27%",
    "--accent-ink": "0 0% 100%",
  },
  dark: {
    "--canvas": "216 33% 8%",
    "--surface": "216 28% 11%",
    "--raised": "215 25% 15%",
    "--line": "215 20% 21%",
    "--line-strong": "215 18% 30%",
    "--ink": "210 25% 96%",
    "--ink-muted": "215 16% 70%",
    "--ink-subtle": "215 13% 57%",
    "--accent": "187 68% 56%",
    "--accent-ink": "216 33% 8%",
  },
};

/** "190 82% 27%" → [r, g, b] em 0–1. */
function hsl(token) {
  const [h, s, l] = token.replace(/%/g, "").split(/\s+/).map(Number);
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [r + m, g + m, b + m];
}

const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luz = (t) => {
  const [r, g, b] = hsl(t);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contraste = (a, b) => {
  const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* Os pares que decidem se a tela é legível, e o piso de cada um. */
const PARES = [
  ["ink sobre surface", "--ink", "--surface", 4.5],
  ["ink-muted sobre surface", "--ink-muted", "--surface", 4.5],
  ["ink-subtle sobre surface", "--ink-subtle", "--surface", 4.5],
  ["ink sobre canvas", "--ink", "--canvas", 4.5],
  ["accent sobre surface", "--accent", "--surface", 3],
  ["accent-ink sobre accent", "--accent-ink", "--accent", 4.5],
  ["line sobre surface", "--line", "--surface", 1.2],
];

let falhas = 0;
for (const p of PALETAS) {
  const modos = p.fixo ? [p.fixo] : ["light", "dark"];
  for (const modo of modos) {
    const tokens = { ...REF[modo], ...((modo === "dark" ? p.escuro : p.claro) ?? {}) };
    const ruins = [];
    for (const [nome, a, b, piso] of PARES) {
      const r = contraste(tokens[a], tokens[b]);
      if (r < piso) ruins.push(`${nome} ${r.toFixed(2)}:1 (piso ${piso})`);
    }
    const rotulo = `${p.nome} · ${modo === "dark" ? "escuro" : "claro"}`;
    if (ruins.length) {
      falhas++;
      console.log(`FALHA ${rotulo}`);
      for (const r of ruins) console.log(`        ${r}`);
    } else {
      const menor = Math.min(
        ...PARES.filter(([, , , piso]) => piso >= 4.5).map(([, a, b]) => contraste(tokens[a], tokens[b])),
      );
      console.log(`ok    ${rotulo.padEnd(28)} pior texto ${menor.toFixed(2)}:1`);
    }
  }
}

console.log(falhas ? `\n${falhas} paleta(s) com contraste insuficiente` : "\ntodas legíveis");
process.exit(falhas ? 1 : 0);
