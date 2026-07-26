/**
 * Confere a geometria do painel sem navegador.
 *
 *   node --experimental-strip-types frontend/scripts/testa_grade.mjs
 *
 * O painel é de posição livre: um bloco fica onde foi solto e nenhum outro se
 * mexe por causa dele. Isso é fácil de quebrar sem perceber — basta uma
 * "correção" bem-intencionada num caso de borda para o arranjo do usuário
 * começar a se rearranjar sozinho, que é exatamente o que não se quer.
 *
 * As invariantes checadas em todas as combinações da bateria aleatória:
 *   1. quem não foi tocado fica IDÊNTICO;
 *   2. quem foi tocado vai para o pedido, aparado só para caber na grade.
 */
import {
  ALTURA_MAX,
  ALTURA_MIN,
  COLUNAS,
  LARGURA_MIN,
  colide,
  limitar,
  linhasOcupadas,
  mover,
  redimensionar,
} from "../src/theme/grade.ts";

const chave = (c) => `${c.id}(${c.x},${c.y} ${c.w}x${c.h})`;
const mostra = (cs) => cs.map(chave).join(" ");
const vaza = (cs) => cs.some((c) => c.x < 0 || c.y < 0 || c.x + c.w > COLUNAS);
/** Todos menos `id`, para comparar antes e depois. */
const resto = (cs, id) =>
  cs
    .filter((c) => c.id !== id)
    .map(chave)
    .sort()
    .join(" ");

let falhas = 0;
const ok = (nome, cond, extra = "") => {
  console.log(`${cond ? "ok   " : "FALHA"} ${nome}${extra ? "  → " + extra : ""}`);
  if (!cond) falhas++;
};

const g = [
  { id: "a", x: 0, y: 0, w: 6, h: 6 },
  { id: "b", x: 6, y: 0, w: 6, h: 6 },
  { id: "c", x: 0, y: 20, w: 4, h: 5 },
];

// --- o que o usuário pediu -------------------------------------------------
let r = mover(g, "a", 3, 9);
ok("o bloco vai exatamente para onde foi solto", chave(r.find((c) => c.id === "a")) === "a(3,9 6x6)", mostra(r));
ok("mover não mexe em mais ninguém", resto(r, "a") === resto(g, "a"));

r = mover(g, "a", 6, 0);
ok(
  "soltar em cima de outro NÃO empurra o outro",
  chave(r.find((c) => c.id === "b")) === "b(6,0 6x6)",
  mostra(r),
);
ok("sobreposição é permitida", r.some((p) => r.some((q) => colide(p, q))));

r = mover(g, "c", 0, 20);
ok("espaço vazio acima NÃO faz o bloco subir", chave(r.find((c) => c.id === "c")) === "c(0,20 4x5)");

r = redimensionar(g, "a", 12, 30);
ok("crescer não desloca o de baixo", resto(r, "a") === resto(g, "a"), mostra(r));

// --- os limites da grade ---------------------------------------------------
r = mover(g, "a", 99, -5);
ok("apara para dentro da grade", chave(r.find((c) => c.id === "a")) === "a(6,0 6x6)", mostra(r));

r = redimensionar(g, "a", 1, 1);
const a = r.find((c) => c.id === "a");
ok("tamanho mínimo respeitado", a.w === LARGURA_MIN && a.h === ALTURA_MIN, mostra(r));

r = redimensionar(g, "a", 99, 999);
const a2 = r.find((c) => c.id === "a");
ok("tamanho máximo respeitado", a2.w === COLUNAS && a2.h === ALTURA_MAX, mostra(r));

ok(
  "o palco tem folga para soltar abaixo de tudo",
  linhasOcupadas(g) > Math.max(...g.map((c) => c.y + c.h)),
  `${linhasOcupadas(g)} linhas`,
);

// --- bateria aleatória -----------------------------------------------------
// Semente fixa: uma falha aqui tem de ser reproduzível.
let semente = 7;
const rnd = (n) => (semente = (semente * 1103515245 + 12345) % 2147483648) % n;
let mexeuEmOutro = 0;
let vazou = 0;
let naoObedeceu = 0;
const RODADAS = 800;

for (let i = 0; i < RODADAS; i++) {
  const antes = [0, 1, 2, 3, 4].map((k) => {
    const w = LARGURA_MIN + rnd(COLUNAS - LARGURA_MIN + 1);
    return { id: "b" + k, x: rnd(COLUNAS - w + 1), y: rnd(20), w, h: ALTURA_MIN + rnd(8) };
  });
  const alvo = "b" + rnd(5);
  const original = antes.find((c) => c.id === alvo);

  let depois;
  let esperado;
  if (rnd(2)) {
    const x = rnd(COLUNAS);
    const y = rnd(30);
    depois = mover(antes, alvo, x, y);
    esperado = limitar({ ...original, x, y });
  } else {
    const w = LARGURA_MIN + rnd(12);
    const h = ALTURA_MIN + rnd(40);
    depois = redimensionar(antes, alvo, w, h);
    esperado = limitar({ ...original, w, h });
  }

  if (resto(depois, alvo) !== resto(antes, alvo)) mexeuEmOutro++;
  if (vaza(depois)) vazou++;
  if (chave(depois.find((c) => c.id === alvo)) !== chave(esperado)) naoObedeceu++;
}

ok(`${RODADAS} operações: nenhum vizinho se moveu`, mexeuEmOutro === 0, `${mexeuEmOutro} moveram`);
ok(`${RODADAS} operações: o alvo foi para onde foi pedido`, naoObedeceu === 0, `${naoObedeceu} desobedeceram`);
ok(`${RODADAS} operações: nada saiu da grade`, vazou === 0, `${vazou} vazaram`);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo passou");
process.exit(falhas ? 1 : 0);
