/**
 * Captura as telas das funcionalidades novas — tema, painel, filtros, paletas.
 *
 * Contra a aplicação REAL, como o screenshots.mjs: sobe um Chromium, abre as
 * telas de verdade e fotografa. Nada é montado para a foto; o que aparece nos
 * gráficos veio do DuckDB.
 *
 *   node scripts/screenshots-painel.mjs <idDoPainel> <idDoTema>
 *
 * Pré-requisitos: backend em :8000 e o Vite em :5173.
 */

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SAIDA = new URL("../../docs/img/", import.meta.url).pathname;
const [PAINEL, TEMA] = process.argv.slice(2);

mkdirSync(SAIDA, { recursive: true });
const log = (m) => console.log(`  ${m}`);

/** Espera o painel terminar de rodar as consultas antes de fotografar. */
async function esperarDados(page) {
  await page
    .waitForFunction(() => document.querySelectorAll("article[data-bloco] svg, article[data-bloco] .text-\\[30px\\]").length > 0, {
      timeout: 120_000,
    })
    .catch(() => log("  (sem dados visíveis — segue)"));
  await page.waitForTimeout(2500);
}

const navegador = await chromium.launch();
const page = await navegador.newPage({
  viewport: { width: 1500, height: 860 },
  deviceScaleFactor: 2,
});

try {
  if (PAINEL) {
    log("painel com filtros…");
    await page.goto(`${APP}/?painel=${PAINEL}`, { waitUntil: "networkidle" });
    await esperarDados(page);
    await page.screenshot({ path: `${SAIDA}07-painel.png` });

    log("lupa aberta…");
    const lupa = page.locator('button[aria-label^="Filtros deste widget"]').first();
    if (await lupa.count()) {
      await lupa.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SAIDA}08-lupa.png` });
      await page.keyboard.press("Escape");
    }
  }

  if (TEMA) {
    log("painel do tema…");
    await page.goto(`${APP}/?tema=${TEMA}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${SAIDA}09-tema.png` });
  }

  log("seletor de paletas…");
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const paleta = page.locator('button[aria-label="Escolher a aparência"]').first();
  if (await paleta.count()) {
    await paleta.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SAIDA}10-paletas.png` });
  }

  log("pronto");
} finally {
  await navegador.close();
}
