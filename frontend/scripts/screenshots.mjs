/**
 * Captura os screenshots do README contra a aplicação REAL.
 *
 * Nada aqui é mock: o script sobe um Chromium, digita as perguntas na
 * interface e espera o agente responder de verdade — então as imagens do README
 * mostram números que vieram do DuckDB, não uma tela montada.
 *
 *   node scripts/screenshots.mjs            # tema escuro (padrão)
 *   node scripts/screenshots.mjs --light
 *
 * Pré-requisitos: backend em :8000 e o Vite em :5173.
 */

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SAIDA = new URL("../../docs/img/", import.meta.url).pathname;
const ESCURO = !process.argv.includes("--light");

// Uma resposta do agente leva ~40s; uma investigação passa de 3 minutos.
const T_RESPOSTA = 180_000;
const T_INVESTIGACAO = 420_000;

mkdirSync(SAIDA, { recursive: true });

const log = (m) => console.log(`  ${m}`);

/** Envia uma pergunta pelo composer e espera a resposta terminar. */
async function perguntar(page, texto, timeout = T_RESPOSTA) {
  log(`perguntando: ${texto.slice(0, 62)}…`);
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(texto);
  await composer.press("Enter");
  // O botão vira "parar" enquanto processa; a volta para "enviar" é o fim.
  await page.waitForSelector('button[aria-label="Enviar pergunta"]', { timeout });
  await page.waitForTimeout(1200); // o gráfico do ECharts pinta logo depois
}

async function capturar(page, nome, alvo) {
  const caminho = `${SAIDA}${nome}.png`;
  await (alvo ?? page).screenshot({ path: caminho });
  log(`→ docs/img/${nome}.png`);
}

/**
 * Põe o topo da última resposta no topo da viewport.
 *
 * A lista de mensagens rola sozinha para o fim quando a resposta chega; sem
 * reposicionar, a captura mostra o rodapé da tabela em vez do texto e do
 * gráfico — que é justamente o que o README precisa mostrar.
 */
async function enquadrarUltimaResposta(page) {
  await page.evaluate(() => {
    const artigos = document.querySelectorAll("main [data-role='agent'], main article, main > div > div");
    const alvo = document.querySelector("main figure")?.closest("div[class*='space-y']")
      ?? artigos[artigos.length - 1];
    alvo?.scrollIntoView({ block: "start" });
    window.scrollBy(0, -80);
  });
  await page.waitForTimeout(700);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // retina, para o texto do README não sair borrado
    colorScheme: ESCURO ? "dark" : "light",
  });

  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // 1. Estado inicial, com as sugestões de pergunta.
  await capturar(page, "01-inicio");

  // 2. Resposta completa: texto, gráfico, SQL e tabela.
  await perguntar(page, "Faça um gráfico da evolução de internações por ano");
  await enquadrarUltimaResposta(page);
  await capturar(page, "02-resposta-com-grafico");

  // 3. Explorador de schema aberto ao lado da conversa.
  // O aria-label alterna entre "Ver" e "Ocultar", então casamos pelo sufixo.
  const btnSchema = page.locator('button[aria-label$="estrutura do banco"]').first();
  await btnSchema.click();
  await page.waitForTimeout(600);
  await capturar(page, "03-schema");
  await btnSchema.click();
  await page.waitForTimeout(400);

  // 4. Trace de depuração: todo o contexto que montou a resposta.
  const debug = page.locator('input[type="checkbox"]').first();
  await debug.check();
  await page.waitForTimeout(700);
  // Abre a primeira entrada do trace, senão a captura mostra só os títulos.
  const entrada = page.locator("summary, [aria-expanded]").filter({ hasText: /Instru|Pergunta recebida/ }).first();
  if (await entrada.count()) {
    await entrada.click().catch(() => {});
    await page.waitForTimeout(500);
    await entrada.scrollIntoViewIfNeeded().catch(() => {});
  }
  await enquadrarUltimaResposta(page);
  await capturar(page, "04-debug-trace");
  await debug.uncheck();
  await page.waitForTimeout(300);

  // 5. Investigação: o modo de várias consultas, com o relatório.
  await page.locator('button[aria-label*="impar"]').first().click().catch(() => {});
  await page.waitForTimeout(500);
  await perguntar(
    page,
    "Existe alguma relação entre internações por câncer e a idade do paciente?",
  );
  const chip = page.locator("button", { hasText: "Investigar a fundo" }).first();
  await chip.click();
  log("investigando… (leva alguns minutos)");
  // O cabeçalho só mostra "de N consultas" quando o relatório fica pronto.
  await page.waitForSelector("text=/\\d+ de \\d+ consultas/", { timeout: T_INVESTIGACAO });
  await page.waitForTimeout(1500);
  await capturar(page, "05-investigacao");

  // 6. Um bloco de evidência aberto, com a definição operacional à mostra.
  const blocos = page.locator('aside[aria-label="Relatório da investigação"] article');
  if (await blocos.count()) {
    await blocos.nth(1).locator("button").first().click();
    await page.waitForTimeout(900);
    await capturar(page, "06-evidencia", page.locator('aside[aria-label="Relatório da investigação"]').first());
  }

  await browser.close();
  console.log("\nconcluído.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
