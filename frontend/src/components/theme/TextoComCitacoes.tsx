import type { ThemeBlock } from "@/lib/types";

/**
 * Como o redator marca a origem: `[blk_a1b2c3d4e5f6]`, e às vezes vários ids no
 * mesmo colchete — `[blk_aaa…; blk_bbb…]`. A instrução pede um por colchete, e
 * o analisador aceita os dois: uma citação que não é reconhecida vira lixo
 * visível no meio da frase, que é pior do que não citar.
 */
const CITACAO = /\[((?:blk_[0-9a-f]{12})(?:\s*[;,]\s*blk_[0-9a-f]{12})*)\]/g;

/** Põe o bloco na tela e o destaca por um instante. */
function irAoBloco(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-bloco="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  // Sem o realce, num painel de dez blocos a pessoa rola até o lugar certo e
  // não sabe qual dos cartões é o citado.
  el.animate(
    [{ boxShadow: "0 0 0 3px hsl(var(--accent) / 0.55)" }, { boxShadow: "none" }],
    { duration: 1400, easing: "ease-out" },
  );
}

/**
 * A resposta com as citações como NOTA DE RODAPÉ, não como rótulo embutido.
 *
 * A primeira versão punha o título do bloco dentro da frase, e o resultado foi
 * ilegível: os títulos são gerados da pergunta que originou o bloco, então uma
 * frase virava "…no período 2007–2014 Quantas pessoas morreram por algum tipo
 * de câncer?." — a citação engolindo o texto. Num panorama com sete citações
 * isso é ruína.
 *
 * Numerado por ordem de aparição, com a legenda embaixo: é como citação
 * funciona em prosa há séculos, e resolve o caso de um mesmo bloco ser citado
 * três vezes — ele é o mesmo número, não três repetições do título.
 *
 * O número não é enfeite: clicar nele, na frase ou na legenda, leva ao cartão.
 * É o que torna "evidência identificada" conferível em vez de ser promessa.
 */
export function TextoComCitacoes({
  texto,
  blocos,
}: {
  texto: string;
  blocos: ThemeBlock[];
}) {
  const porId = new Map(blocos.map((b) => [b.id, b]));
  const numero = new Map<string, number>();
  const pedacos: (string | { id: string; n: number })[] = [];
  let ultimo = 0;

  for (const m of texto.matchAll(CITACAO)) {
    if (m.index! > ultimo) pedacos.push(texto.slice(ultimo, m.index));
    for (const id of m[1].split(/\s*[;,]\s*/)) {
      if (!numero.has(id)) numero.set(id, numero.size + 1);
      pedacos.push({ id, n: numero.get(id)! });
    }
    ultimo = m.index! + m[0].length;
  }
  if (ultimo < texto.length) pedacos.push(texto.slice(ultimo));

  return (
    <div className="px-1">
      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
        {pedacos.map((p, i) =>
          typeof p === "string" ? (
            <span key={i}>{p}</span>
          ) : (
            <button
              key={i}
              onClick={() => irAoBloco(p.id)}
              title={porId.get(p.id)?.title || "Bloco do tema"}
              aria-label={`Fonte ${p.n}: ${porId.get(p.id)?.title ?? "bloco do tema"}`}
              className="mx-px inline-flex h-[15px] min-w-[15px] items-center justify-center rounded bg-accent-soft px-1 align-super text-[9.5px] font-semibold leading-none text-accent transition-colors duration-150 hover:bg-accent hover:text-white"
            >
              {p.n}
            </button>
          ),
        )}
      </p>

      {numero.size > 0 && (
        <ol className="mt-2.5 space-y-0.5 border-t border-line pt-2">
          {[...numero.entries()].map(([id, n]) => {
            const b = porId.get(id);
            return (
              <li key={id} className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-[9.5px] font-semibold text-accent">{n}</span>
                <button
                  onClick={() => irAoBloco(id)}
                  className="min-w-0 flex-1 truncate text-left text-[11px] text-ink-muted transition-colors duration-150 hover:text-accent"
                >
                  {b?.title || "bloco do tema"}
                  {b && b.provenance !== "banco" && (
                    <span className="text-ink-subtle"> · fonte externa</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
