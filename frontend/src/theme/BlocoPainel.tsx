import { ChevronDown, GripVertical, Trash2 } from "lucide-react";
import { useState } from "react";
import { ResultChart } from "@/components/result/ResultChart";
import { ResultTable } from "@/components/result/ResultTable";
import { SqlBlock } from "@/components/result/SqlBlock";
import { PapelDoAchado, SeloDePapel } from "@/components/theme/PapelDoAchado";
import { SourceBadge } from "@/components/theme/SourceBadge";
import { classifyBlock, layoutBlock, noteBlock, unpinBlock } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BlockFormat, ThemeBlock } from "@/lib/types";
import type { Celula } from "./grade";
import type { Gesto } from "./usePainel";

const nf = new Intl.NumberFormat("pt-BR");

const FORMATOS: { valor: BlockFormat; rotulo: string }[] = [
  { valor: "auto", rotulo: "Automático" },
  { valor: "indicador", rotulo: "Número" },
  { valor: "grafico", rotulo: "Gráfico" },
  { valor: "tabela", rotulo: "Tabela" },
  { valor: "citacao", rotulo: "Citação" },
];

/**
 * Decide como mostrar um bloco em `auto`.
 *
 * A regra é o formato do RESULTADO, não a intenção de quem perguntou: uma
 * consulta que devolve uma linha e uma coluna é um número, e mostrá-la como
 * tabela desperdiça o bloco inteiro com um cabeçalho e uma célula.
 */
function formatoEfetivo(b: ThemeBlock): Exclude<BlockFormat, "auto"> {
  if (b.format !== "auto") return b.format;
  if (b.provenance !== "banco") return "citacao";
  const r = b.result;
  if (r && r.nRows === 1 && r.columns.length === 1) return "indicador";
  if (b.chart) return "grafico";
  return "tabela";
}

/** O valor único de um resultado 1×1, já formatado. */
function valorUnico(b: ThemeBlock): { valor: string; rotulo: string } | null {
  const r = b.result;
  if (!r?.rows.length) return null;
  const v = r.rows[0][0];
  return {
    valor: typeof v === "number" ? nf.format(v) : String(v ?? "—"),
    rotulo: r.columns[0]?.replace(/_/g, " ") ?? "",
  };
}

interface Props {
  bloco: ThemeBlock;
  temaId: string;
  onMudou: () => void;
  /** A célula que este bloco ocupa agora — durante um gesto, a de destino. */
  celula: Celula;
  /** Que gesto está em curso NESTE bloco, se algum. */
  gesto: Gesto | null;
  comecar: (id: string, tipo: Gesto, e: React.PointerEvent) => void;
  porTeclado: (id: string, d: Partial<Celula>) => void;
}

/**
 * Um bloco do painel: muda de forma, de tamanho e de lugar sem mudar de
 * conteúdo.
 *
 * A altura vem da grade, não do conteúdo — é o que permite puxar a borda de
 * baixo. Em troca, o corpo tem de caber: ele rola dentro do bloco, e o gráfico
 * se estica para ocupar o que sobrar. Sem isso, um bloco baixo cortaria o
 * gráfico pela metade em vez de encolhê-lo.
 *
 * O detalhe — SQL, tabela completa, suposições, anotação — vive atrás de um
 * clique. Num painel que se lê de relance, deixá-lo sempre aberto transforma
 * quatro blocos numa página de rolagem.
 */
export function BlocoPainel({ bloco, temaId, onMudou, celula, gesto, comecar, porTeclado }: Props) {
  const [aberto, setAberto] = useState(false);
  const [anotacao, setAnotacao] = useState(bloco.note);
  const formato = formatoEfetivo(bloco);
  const emMovimento = gesto === "mover";
  const emResize = gesto !== null && gesto !== "mover";

  async function ajustarFormato(format: BlockFormat) {
    await layoutBlock(temaId, bloco.id, { format });
    onMudou();
  }

  return (
    <article
      // O alvo do arrasto é achado por elementFromPoint; é este atributo que o
      // ponto na tela vira id de bloco.
      data-bloco={bloco.id}
      className={cn(
        "group relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-surface",
        "transition-[box-shadow,border-color,opacity] duration-150",
        bloco.provenance === "banco" ? "border-line" : "border-caution/25 bg-caution-soft",
        // A contradição muda a borda do card. Num mosaico de dez, ela é o
        // único achado que ninguém pode deixar de ver — e antes disto ela
        // tinha exatamente o mesmo peso visual do número que confirmava o que
        // já se pensava.
        bloco.role === "contradiz" && "border-caution ring-1 ring-caution/25",
        bloco.role === "sustenta" && "border-positive/40",
        emResize && "border-accent/50 shadow-lg",
        // Levantado do painel: sombra forte e leve inclinação de escala dizem
        // "isto está na mão", que é o que falta quando o bloco só desliza.
        emMovimento && "scale-[1.02] cursor-grabbing border-accent/60 opacity-90 shadow-2xl",
      )}
    >
      {/* O tamanho, enquanto se mexe. O bloco arrastado continua visível e
          inteiro — quem marca a vaga é o contorno tracejado no palco, e ele já
          mostra o resultado da colisão. Esconder o conteúdo aqui seria esconder
          justamente o que a pessoa está tentando posicionar. */}
      {(emMovimento || emResize) && (
        <span className="pointer-events-none absolute bottom-2 right-5 z-20 rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-white shadow-sm [font-variant-numeric:tabular-nums]">
          {celula.w} × {celula.h}
        </span>
      )}

      <header className="flex shrink-0 items-start gap-2 px-3.5 pb-1.5 pt-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12.5px] font-medium leading-snug text-ink">
            {bloco.title || bloco.question}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <SourceBadge provenance={bloco.provenance} />
            <SeloDePapel papel={bloco.role} peso={bloco.weight} compacto />
            {bloco.result && formato !== "indicador" && (
              <span className="text-[10.5px] text-ink-subtle">
                {nf.format(bloco.result.nRows)} linhas
              </span>
            )}
          </div>
        </div>

        {/* Os controles só aparecem no hover: num painel, a moldura tem de sumir
            para o conteúdo aparecer. Continuam alcançáveis pelo teclado. */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <button
            onPointerDown={(e) => comecar(bloco.id, "mover", e)}
            onKeyDown={(e) => {
              const d =
                e.key === "ArrowLeft" ? { x: -1 }
                : e.key === "ArrowRight" ? { x: 1 }
                : e.key === "ArrowUp" ? { y: -1 }
                : e.key === "ArrowDown" ? { y: 1 }
                : null;
              if (!d) return;
              e.preventDefault();
              porTeclado(bloco.id, d);
            }}
            aria-label="Mover o bloco: arraste, ou use as setas"
            className="cursor-grab touch-none rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-ink active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="h-3.5 w-3.5" />
          </button>
          <select
            value={bloco.format}
            onChange={(e) => void ajustarFormato(e.target.value as BlockFormat)}
            aria-label="Formato do bloco"
            className="rounded-md border border-line bg-surface px-1 py-0.5 text-[10.5px] text-ink-muted outline-none focus:border-accent"
          >
            {FORMATOS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              await unpinBlock(temaId, bloco.id);
              onMudou();
            }}
            aria-label="Remover do tema"
            className="rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-critical"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* O corpo rola dentro do bloco: a altura é da grade, e o conteúdo se
          acomoda nela em vez de esticá-la. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-2">
        {/* Fica FORA do detalhe, de propósito: é a única linha do card que diz
            o que a evidência prova, e escondê-la atrás de um clique devolveria
            o mosaico ao estado em que dez cards se parecem. */}
        {bloco.why && (
          <p className="rounded-r border-l-2 border-accent bg-accent-soft/50 py-1 pl-2 pr-1.5 text-[11px] leading-snug text-ink">
            {bloco.why}
          </p>
        )}
        {formato === "indicador" && valorUnico(bloco) && (
          <div className="flex flex-1 flex-col justify-center py-1">
            <span className="text-[30px] font-semibold leading-none tracking-tight text-ink [font-variant-numeric:tabular-nums]">
              {valorUnico(bloco)!.valor}
            </span>
            <span className="mt-1 text-[11px] text-ink-subtle">{valorUnico(bloco)!.rotulo}</span>
          </div>
        )}

        {/* O piso é do CONTEÚDO, não do bloco: um bloco pode ser baixo — para um
            indicador isso é ótimo — mas um gráfico espremido em 60px não é
            gráfico, é um borrão. Abaixo deste piso o corpo rola em vez de
            achatar. */}
        {formato === "grafico" && bloco.chart && bloco.result && (
          <div className="min-h-[170px] flex-1">
            <ResultChart spec={bloco.chart} result={bloco.result} preencher />
          </div>
        )}
        {formato === "grafico" && !bloco.chart && (
          <p className="py-3 text-[11.5px] text-ink-subtle">
            Este resultado não tem gráfico declarado. Escolha outro formato.
          </p>
        )}

        {formato === "tabela" && bloco.result && <ResultTable result={bloco.result} />}

        {formato === "citacao" && (
          <div>
            {bloco.text && (
              <p className="text-[12.5px] italic leading-relaxed text-ink">
                &ldquo;{bloco.text}&rdquo;
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {bloco.sourceUrl ? (
                <a
                  href={bloco.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline decoration-dotted underline-offset-2 hover:text-accent"
                >
                  {bloco.sourceTitle || dominio(bloco.sourceUrl)}
                </a>
              ) : (
                "Anotação sem fonte externa"
              )}
              {bloco.accessedAt && ` · acesso ${bloco.accessedAt}`}
            </p>
          </div>
        )}

        {/* Um resumo em uma linha quando o formato não é o texto em si. */}
        {bloco.text && formato !== "citacao" && !aberto && (
          <p className="line-clamp-2 shrink-0 text-[11.5px] leading-snug text-ink-muted">
            {bloco.text}
          </p>
        )}

        {aberto && (
          <div className="shrink-0 space-y-2.5 border-t border-line pt-2.5">
            {bloco.definition && (
              <div className="rounded-lg bg-raised px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                  O que foi medido
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
                  {bloco.definition}
                </p>
              </div>
            )}
            {bloco.text && formato !== "citacao" && (
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink">
                {bloco.text}
              </p>
            )}
            {bloco.assumptions.length > 0 && (
              <p className="text-[11px] leading-relaxed text-ink-subtle">
                <span className="font-medium">Suposições:</span> {bloco.assumptions.join(" · ")}
              </p>
            )}
            {bloco.sql && <SqlBlock sql={bloco.sql} />}
            {bloco.result && formato !== "tabela" && <ResultTable result={bloco.result} />}
            <PapelDoAchado
              papel={bloco.role}
              peso={bloco.weight}
              porque={bloco.why}
              onMudar={async (patch) => {
                await classifyBlock(temaId, bloco.id, patch);
                onMudou();
              }}
            />
            <textarea
              value={anotacao}
              onChange={(e) => setAnotacao(e.target.value)}
              onBlur={async () => {
                if (anotacao !== bloco.note) {
                  await noteBlock(temaId, bloco.id, anotacao);
                  onMudou();
                }
              }}
              rows={2}
              placeholder="Anotação de trabalho — rascunho, dúvida, o que conferir depois"
              className="block w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] leading-relaxed text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent"
            />
          </div>
        )}
      </div>

      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex shrink-0 items-center gap-1 px-3.5 pb-2 pt-0.5 text-[11px] text-ink-subtle transition-colors duration-150 hover:text-accent"
      >
        <ChevronDown
          aria-hidden
          className={cn("h-3 w-3 transition-transform duration-150", aberto && "rotate-180")}
        />
        {aberto ? "menos" : "detalhe"}
      </button>

      {/* ---- as bordas ----
          Faixas invisíveis sobre a borda, largas o bastante para o ponteiro
          acertar — a borda de 1px não é alvo. Sempre presentes, e não só no
          hover: quem já sabe que dá para puxar não deveria descobrir de novo a
          cada bloco. */}
      <span
        onPointerDown={(e) => comecar(bloco.id, "direita", e)}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize touch-none opacity-0 transition-opacity duration-150 hover:opacity-100 group-hover:opacity-60"
        style={{ background: "linear-gradient(to right, transparent, var(--accent))" }}
        aria-hidden
      />
      <span
        onPointerDown={(e) => comecar(bloco.id, "baixo", e)}
        className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize touch-none opacity-0 transition-opacity duration-150 hover:opacity-100 group-hover:opacity-60"
        style={{ background: "linear-gradient(to bottom, transparent, var(--accent))" }}
        aria-hidden
      />
      <button
        onPointerDown={(e) => comecar(bloco.id, "quina", e)}
        onKeyDown={(e) => {
          const d: Partial<Celula> | null =
            e.key === "ArrowRight" ? { w: 1 }
            : e.key === "ArrowLeft" ? { w: -1 }
            : e.key === "ArrowDown" ? { h: 1 }
            : e.key === "ArrowUp" ? { h: -1 }
            : null;
          if (!d) return;
          e.preventDefault();
          porTeclado(bloco.id, d);
        }}
        aria-label="Redimensionar o bloco: arraste a quina, ou use as setas"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none rounded-tl-md opacity-0 transition-opacity duration-150 focus:opacity-100 group-hover:opacity-100"
      >
        <svg viewBox="0 0 10 10" className="h-full w-full text-ink-subtle" aria-hidden>
          <path d="M9 3 L3 9 M9 6.5 L6.5 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>
    </article>
  );
}

/** Só o domínio, para o rótulo do link não estourar a largura do bloco. */
function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
