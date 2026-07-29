import { Check, Info } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CatalogField, PanelStep } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Um painel que sai de dentro do cartão.
 *
 * O widget tem `overflow-hidden` — ele precisa, para as quinas arredondadas e
 * para o gráfico não vazar — e isso CORTA qualquer coisa posicionada dentro
 * dele. Um menu de 22rem aberto num indicador de três linhas aparecia pela
 * metade, com o botão de aplicar fora da tela.
 *
 * A saída é o portal: o painel vive no `body` e se posiciona pela âncora. Como
 * ele passa a ser `fixed`, também precisa saber virar para cima quando não há
 * espaço embaixo, e encostar na borda direita sem sair dela.
 */
export function Flutuante({
  ancora,
  largura,
  children,
}: {
  ancora: React.RefObject<HTMLElement>;
  /** Em px. Serve para o painel não passar da borda direita da janela. */
  largura: number;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const alvo = ancora.current;
    if (!alvo) return;
    const medir = () => {
      const r = alvo.getBoundingClientRect();
      const alto = caixa.current?.offsetHeight ?? 320;
      const cabeAbaixo = r.bottom + alto + 8 < innerHeight;
      setPos({
        top: cabeAbaixo ? r.bottom + 4 : Math.max(8, r.top - alto - 4),
        left: Math.max(8, Math.min(r.right - largura, innerWidth - largura - 8)),
      });
    };
    medir();
    // Rolar ou redimensionar move a âncora; sem isto o painel fica flutuando
    // sozinho onde o botão estava.
    addEventListener("scroll", medir, true);
    addEventListener("resize", medir);
    return () => {
      removeEventListener("scroll", medir, true);
      removeEventListener("resize", medir);
    };
  }, [ancora, largura]);

  return createPortal(
    <div
      ref={caixa}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: largura,
        // Antes de medir, invisível: um quadro no canto errado antes de saltar
        // para o lugar certo é pior que um quadro a mais de espera.
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-50"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * As peças que o menu de criação e o editor de widget usam em comum.
 *
 * Elas moram aqui e não em cada tela porque as duas montam a MESMA coisa: o
 * menu cria um gráfico a partir de escolhas, o editor refaz o mesmo gráfico a
 * partir das escolhas guardadas. Duas cópias do formulário divergiriam — e a
 * divergência apareceria como "editar mudou algo que eu não toquei".
 */

export const SELECT =
  "w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12.5px] text-ink outline-none transition-colors duration-150 focus:border-accent";

/** Um `<label>` de verdade: teclado, leitor de tela e busca por digitação. */
export function Campo({
  rotulo,
  children,
  dica,
}: {
  rotulo: string;
  children: React.ReactNode;
  dica?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        {rotulo}
        {dica && (
          <span title={dica} className="cursor-help">
            <Info aria-hidden className="h-3 w-3" />
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

export function porGrupo(campos: CatalogField[]): [string, CatalogField[]][] {
  const mapa = new Map<string, CatalogField[]>();
  for (const c of campos) mapa.set(c.group, [...(mapa.get(c.group) ?? []), c]);
  return [...mapa.entries()];
}

export function Alternador({
  ligado,
  onMudar,
  children,
}: {
  ligado: boolean;
  onMudar: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onMudar(!ligado)}
      aria-pressed={ligado}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors duration-150",
        ligado
          ? "border-accent bg-accent-soft text-accent"
          : "border-line text-ink-muted hover:text-ink",
      )}
    >
      <span
        className={cn(
          "flex h-3 w-3 items-center justify-center rounded-sm border",
          ligado ? "border-accent bg-accent text-white" : "border-line",
        )}
      >
        {ligado && <Check aria-hidden className="h-2 w-2" strokeWidth={4} />}
      </span>
      {children}
    </button>
  );
}

export function Recusa({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <p className="rounded-lg bg-caution-soft px-3 py-2 text-[11.5px] leading-relaxed text-ink">
      {texto}
    </p>
  );
}

/**
 * O relato do servidor: uma linha por etapa, na ordem em que chegou.
 *
 * Sem porcentagem, de propósito. O passo caro é o modelo escrever a consulta —
 * de dez a quarenta segundos, e ninguém sabe quantos de antemão. Uma barra
 * determinada chegaria ao fim antes dele e ficaria parada em 100%,
 * indistinguível de travada. A varredura é INDETERMINADA: diz "está
 * acontecendo" e nada além.
 */
export function ListaDeEtapas({
  etapas,
  compacta = false,
  extra,
}: {
  etapas: PanelStep[];
  /** Na fila do canto o espaço é menor, e a lista rola. */
  compacta?: boolean;
  /** Renderizado ao lado do rótulo da etapa em curso — o cronômetro. */
  extra?: (e: PanelStep) => React.ReactNode;
}) {
  const caixa = useRef<HTMLOListElement>(null);
  const quantas = useRef(etapas.length);

  useEffect(() => {
    // Rola para a etapa nova. Só quando o número CRESCE: uma etapa mudando de
    // "fazendo" para "feita" não deve puxar a lista de volta se a pessoa subiu
    // para reler o que já passou.
    if (etapas.length > quantas.current) {
      caixa.current?.scrollTo({ top: caixa.current.scrollHeight, behavior: "smooth" });
    }
    quantas.current = etapas.length;
  }, [etapas.length]);

  return (
    <ol
      ref={caixa}
      className={cn(
        "space-y-1 border-l border-line pl-3",
        compacta ? "ml-[7px] mt-1.5 max-h-40 overflow-y-auto" : "ml-[3px]",
      )}
    >
      {etapas.map((e) => (
        <li key={e.id} className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute -left-[17px] top-[5px] h-[7px] w-[7px] rounded-full border",
              e.state === "feita" && "border-positive bg-positive",
              e.state === "fazendo" && "border-accent bg-accent",
              e.state === "falhou" && "border-critical bg-critical",
            )}
          />
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 leading-snug",
                compacta ? "text-[10.5px]" : "text-[11.5px]",
                e.state === "fazendo" ? "text-ink" : "text-ink-muted",
                e.state === "falhou" && "text-critical",
              )}
            >
              {e.label}
            </span>
            {e.state === "fazendo" && extra?.(e)}
          </div>
          {e.detail && (
            <span
              className={cn(
                "block truncate leading-snug text-ink-subtle",
                compacta ? "text-[10px]" : "text-[10.5px]",
              )}
            >
              {e.detail}
            </span>
          )}
          {e.state === "fazendo" && (
            <span aria-hidden className="mt-1 block h-px w-full overflow-hidden rounded bg-line">
              <span className="block h-full w-1/4 animate-varre rounded bg-accent" />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
