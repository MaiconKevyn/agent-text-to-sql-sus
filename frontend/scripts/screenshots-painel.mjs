/**
 * Captura as telas das funcionalidades novas — tema, painel, filtros, paletas.
 *
 * Contra a aplicação REAL, como o screenshots.mjs: sobe um Chromium, abre as
 * telas de verdade e fotografa. Nada é montado para a foto; o que aparece nos
 * gráficos veio do DuckDB.
 *
 *   node scripts/screenshots-painel.mjs <idDoPainel> <idDoTema> [assuntoDaAnálise]
 *
 * O terceiro argumento é opcional e roda o planejador de verdade — uma chamada
 * em esforço alto, de um a dois minutos. Sem ele, a foto do plano não é
 * refeita.
 *
 * Pré-requisitos: backend em :8000 e o Vite em :5173.
 */

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SAIDA = new URL("../../docs/img/", import.meta.url).pathname;
const [PAINEL, TEMA, ASSUNTO] = process.argv.slice(2);

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

  if (PAINEL) {
    log("menu de criação…");
    await page.goto(`${APP}/?painel=${PAINEL}`, { waitUntil: "networkidle" });
    await esperarDados(page);
    const montar = page.getByRole("button", { name: "Montar" });
    if (await montar.count()) {
      await montar.click();
      await page.waitForTimeout(700);
      // Só o diálogo: a página atrás dele já é a foto 07, e repeti-la aqui
      // faria o menu — que é o assunto — ocupar um terço do quadro.
      const caixa = page.getByRole("dialog");
      await caixa.screenshot({ path: `${SAIDA}11-menu.png` });

      if (ASSUNTO) {
        // O planejamento é uma chamada em esforço alto e leva de um a dois
        // minutos — por isso é opcional, e não parte da rodada normal.
        log(`plano de análise ("${ASSUNTO}")… isso leva ~2 min`);
        await caixa.getByRole("button", { name: "Análise completa" }).click();
        await caixa.locator("textarea").fill(ASSUNTO);
        await caixa.getByRole("button", { name: "Planejar" }).click();
        await caixa.getByRole("button", { name: /^Criar \d+ ite/ }).waitFor({ timeout: 240_000 });
        await page.waitForTimeout(600);
        await caixa.screenshot({ path: `${SAIDA}12-plano.png` });
      }
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
