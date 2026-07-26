/**
 * Confere a geometria do painel sem navegador.
 *
 *   node --experimental-strip-types frontend/scripts/testa_grade.mjs
 *
 * O motor da grade decide onde cada bloco fica quando outro é movido ou
 * redimensionado, e erra em silêncio: um arranjo com blocos sobrepostos não
 * quebra nada, só fica errado na tela. Arrastar à mão para conferir cobre um
 * caso por vez; aqui dá para varrer centenas.
 *
 * As duas invariantes que importam, e que a bateria aleatória checa em todas as
 * combinações: nenhum par de blocos se sobrepõe, e nenhum bloco sai da grade.
 */
import { colide, compactar, mover, redimensionar, ALTURA_MIN, COLUNAS, LARGURA_MIN } from "../src/theme/grade.ts";

const mostra = (cs) =>
  cs
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => `${c.id}(${c.x},${c.y} ${c.w}x${c.h})`)
    .join(" ");
const sobrepoe = (cs) => cs.some((a) => cs.some((b) => colide(a, b)));
const vaza = (cs) => cs.some((c) => c.x < 0 || c.y < 0 || c.x + c.w > COLUNAS);

let falhas = 0;
const ok = (nome, cond, extra = "") => {
  console.log(`${cond ? "ok   " : "FALHA"} ${nome}${extra ? "  → " + extra : ""}`);
  if (!cond) falhas++;
};

let g = [
  { id: "a", x: 0, y: 0, w: 6, h: 6 },
  { id: "b", x: 6, y: 0, w: 6, h: 6 },
];

ok("mover para vaga ocupada empurra o ocupante", !sobrepoe(mover(g, "a", 6, 0)), mostra(mover(g, "a", 6, 0)));
ok("lado a lado permanece lado a lado", compactar(g).every((c) => c.y === 0), mostra(compactar(g)));
ok("movimento nulo é inócuo", mostra(mover(g, "a", 0, 0)) === mostra(g));
ok("apara nas bordas", !vaza(mover(g, "a", 99, -5)), mostra(mover(g, "a", 99, -5)));

let r = compactar([
  { id: "a", x: 0, y: 0, w: 6, h: 6 },
  { id: "b", x: 0, y: 20, w: 6, h: 6 },
]);
ok("compacta o buraco", r.find((c) => c.id === "b").y === 6, mostra(r));

g = [
  { id: "a", x: 0, y: 0, w: 6, h: 6 },
  { id: "b", x: 0, y: 6, w: 6, h: 6 },
];
r = redimensionar(g, "a", 6, 10);
ok("crescer empurra o de baixo", !sobrepoe(r) && r.find((c) => c.id === "b").y === 10, mostra(r));

r = redimensionar(g, "a", 1, 1);
const a = r.find((c) => c.id === "a");
ok("mínimos respeitados", a.w === LARGURA_MIN && a.h === ALTURA_MIN, mostra(r));

r = mover(
  [
    { id: "a", x: 0, y: 0, w: 12, h: 4 },
    { id: "b", x: 0, y: 4, w: 12, h: 4 },
    { id: "c", x: 0, y: 8, w: 12, h: 4 },
  ],
  "c",
  0,
  0,
);
ok("cascata de três", !sobrepoe(r) && new Set(r.map((c) => c.y)).size === 3, mostra(r));

// Bateria aleatória. A semente é fixa: uma falha aqui tem de ser reproduzível.
let semente = 7;
const rnd = (n) => (semente = (semente * 1103515245 + 12345) % 2147483648) % n;
let ruins = 0;
const RODADAS = 800;
for (let i = 0; i < RODADAS; i++) {
  let cs = [0, 1, 2, 3, 4].map((k) => {
    const w = LARGURA_MIN + rnd(COLUNAS - LARGURA_MIN + 1);
    return { id: "b" + k, x: rnd(COLUNAS - w + 1), y: rnd(20), w, h: ALTURA_MIN + rnd(8) };
  });
  cs = compactar(cs);
  const alvo = "b" + rnd(5);
  cs = rnd(2)
    ? mover(cs, alvo, rnd(COLUNAS), rnd(20))
    : redimensionar(cs, alvo, LARGURA_MIN + rnd(9), ALTURA_MIN + rnd(10));
  if (sobrepoe(cs) || vaza(cs)) ruins++;
}
ok(`${RODADAS} arranjos aleatórios sem sobreposição nem vazamento`, ruins === 0, `${ruins} ruins`);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo passou");
process.exit(falhas ? 1 : 0);
