/**
 * Decide se vale OFERECER o modo investigação para uma pergunta.
 *
 * Oferecer, não decidir por conta própria: uma investigação custa 7-9 chamadas
 * ao modelo e vários minutos. A escolha é do usuário; isto só evita que ele
 * precise saber que o modo existe.
 *
 * Heurística de propósito — não um classificador. Erro em qualquer direção é
 * barato: um falso positivo mostra um botão que ninguém clica, um falso
 * negativo esconde um botão que o usuário pode acionar de outro jeito.
 */

/** Pede explicitamente uma investigação, um relatório ou uma análise. */
const PEDIDO_EXPLICITO =
  /\b(investig|aprofund|an[áa]lise completa|relat[óo]rio|dashboard|estud[oa]r?\b|explor)/i;

/** Pergunta de relação entre variáveis — a que mais precisa de denominador. */
const RELACAO =
  /\b(rela[çc][ãa]o|associa[çc][ãa]o|correlac|influenc|impact|afet|depend[e|ê]nc|difer(en[çc]a|e)\s+entre)/i;

/** Pergunta de causa: a base não responde, mas o relatório explica por quê. */
const CAUSA = /\b(por que|porqu[êe]|o que explica|qual o motivo|causa[ms]?\b)/i;

/** Compara grupos — quase sempre exige um panorama antes. */
const COMPARACAO = /\b(compar|versus|\bvs\b|em rela[çc][ãa]o a|frente a|maior entre|menor entre)/i;

/** Conta quantas perguntas independentes há no texto. */
function quantasPerguntas(texto: string): number {
  const porInterrogacao = (texto.match(/\?/g) ?? []).length;
  // "quero saber X, Y e se Z" não usa interrogação, mas são três perguntas.
  const porEnumeracao = /\b(e tamb[ée]m|,\s*(quais|quanto|como|se|onde|quando)\b)/gi;
  return Math.max(porInterrogacao, (texto.match(porEnumeracao) ?? []).length + 1);
}

export interface Sugestao {
  vale: boolean;
  /** Por que foi oferecido. Vira o texto do botão. */
  motivo: string;
}

export function sugereInvestigacao(pergunta: string): Sugestao {
  const t = pergunta.trim();
  if (t.length < 25) return { vale: false, motivo: "" };

  if (PEDIDO_EXPLICITO.test(t)) return { vale: true, motivo: "você pediu uma análise" };
  if (quantasPerguntas(t) >= 2) return { vale: true, motivo: "são várias perguntas" };
  if (RELACAO.test(t)) return { vale: true, motivo: "relação entre variáveis precisa de comparação" };
  if (CAUSA.test(t)) return { vale: true, motivo: "pergunta de causa exige testar alternativas" };
  if (COMPARACAO.test(t) && t.length > 60) {
    return { vale: true, motivo: "comparação pede um panorama antes" };
  }
  return { vale: false, motivo: "" };
}
