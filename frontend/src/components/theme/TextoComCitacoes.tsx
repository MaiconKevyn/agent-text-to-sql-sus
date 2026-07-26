import type { ThemeBlock } from "@/lib/types";

/** Como o redator marca a origem de cada número: `[blk_a1b2c3d4e5f6]`. */
const CITACAO = /\[(blk_[0-9a-f]{12})\]/g;

/**
 * Mostra a resposta com cada citação virando um chip que leva ao bloco.
 *
 * A citação é o que permite responder a partir do tema sem afrouxar a garantia
 * do produto: o número não veio da consulta de agora, veio de uma evidência
 * IDENTIFICADA — e o chip é o que torna "identificada" verificável em vez de
 * ser uma promessa. Um clique põe o card na tela; se o número não bater com o
 * que está lá, o defeito aparece.
 *
 * O id cru nunca aparece: `blk_a1b2c3d4e5f6` não diz nada a ninguém. O chip
 * mostra o título do bloco.
 */
export function TextoComCitacoes({
  texto,
  blocos,
}: {
  texto: string;
  blocos: ThemeBlock[];
}) {
  const porId = new Map(blocos.map((b) => [b.id, b]));
  const pedacos: (string | { id: string })[] = [];
  let ultimo = 0;

  for (const m of texto.matchAll(CITACAO)) {
    if (m.index! > ultimo) pedacos.push(texto.slice(ultimo, m.index));
    pedacos.push({ id: m[1] });
    ultimo = m.index! + m[0].length;
  }
  if (ultimo < texto.length) pedacos.push(texto.slice(ultimo));

  return (
    <p className="whitespace-pre-wrap px-1 text-[12.5px] leading-relaxed text-ink">
      {pedacos.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <button
            key={i}
            onClick={() => {
              const el = document.querySelector<HTMLElement>(`[data-bloco="${p.id}"]`);
              if (!el) return;
              el.scrollIntoView({ block: "center", behavior: "smooth" });
              // Um realce curto: sem ele, num painel de dez blocos a pessoa
              // rola até o lugar certo e não sabe qual dos cartões é o citado.
              el.animate(
                [{ boxShadow: "0 0 0 3px hsl(var(--accent) / 0.55)" }, { boxShadow: "none" }],
                { duration: 1400, easing: "ease-out" },
              );
            }}
            title={porId.get(p.id)?.title || "Bloco do tema"}
            className="mx-0.5 inline-flex max-w-[14rem] items-baseline gap-1 truncate rounded border border-accent/35 bg-accent-soft px-1.5 py-px align-baseline text-[11px] text-accent transition-colors duration-150 hover:border-accent"
          >
            {porId.get(p.id)?.title || "bloco do tema"}
          </button>
        ),
      )}
    </p>
  );
}
