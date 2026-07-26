import { ChevronDown, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { useState } from "react";
import { ResultChart } from "@/components/result/ResultChart";
import { ResultTable } from "@/components/result/ResultTable";
import { SqlBlock } from "@/components/result/SqlBlock";
import { SourceBadge } from "@/components/theme/SourceBadge";
import { layoutBlock, noteBlock, unpinBlock } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BlockFormat, BlockSize, ThemeBlock } from "@/lib/types";

const nf = new Intl.NumberFormat("pt-BR");

/** Ordem dos tamanhos, para os botões de aumentar e diminuir. */
const TAMANHOS: BlockSize[] = ["p", "m", "g"];

const SPAN: Record<BlockSize, string> = {
  p: "md:col-span-1",
  m: "md:col-span-2",
  g: "md:col-span-3",
};

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
}

/**
 * Um bloco do painel: muda de forma e de tamanho sem mudar de conteúdo.
 *
 * O detalhe — SQL, tabela completa, suposições, anotação — vive atrás de um
 * clique. Num painel que se lê de relance, deixá-lo sempre aberto transforma
 * quatro blocos numa página de rolagem, que é justamente o que estávamos
 * tentando deixar de ser.
 */
export function BlocoPainel({ bloco, temaId, onMudou }: Props) {
  const [aberto, setAberto] = useState(false);
  const [anotacao, setAnotacao] = useState(bloco.note);
  const formato = formatoEfetivo(bloco);
  const i = TAMANHOS.indexOf(bloco.size);

  async function ajustar(mudanca: { format?: BlockFormat; size?: BlockSize }) {
    await layoutBlock(temaId, bloco.id, mudanca);
    onMudou();
  }

  return (
    <article
      className={cn(
        "group relative flex min-w-0 flex-col gap-2.5 rounded-xl border bg-surface px-3.5 py-3",
        SPAN[bloco.size],
        bloco.provenance === "banco" ? "border-line" : "border-caution/25 bg-caution-soft",
      )}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12.5px] font-medium leading-snug text-ink">
            {bloco.title || bloco.question}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <SourceBadge provenance={bloco.provenance} />
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
          <select
            value={bloco.format}
            onChange={(e) => void ajustar({ format: e.target.value as BlockFormat })}
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
            onClick={() => void ajustar({ size: TAMANHOS[i - 1] })}
            disabled={i === 0}
            aria-label="Diminuir o bloco"
            className="rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-ink disabled:opacity-30"
          >
            <Minimize2 aria-hidden className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void ajustar({ size: TAMANHOS[i + 1] })}
            disabled={i === TAMANHOS.length - 1}
            aria-label="Aumentar o bloco"
            className="rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-ink disabled:opacity-30"
          >
            <Maximize2 aria-hidden className="h-3.5 w-3.5" />
          </button>
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

      {/* ---- o corpo, conforme o formato ---- */}
      {formato === "indicador" && valorUnico(bloco) && (
        <div className="flex flex-1 flex-col justify-center py-1">
          <span className="text-[30px] font-semibold leading-none tracking-tight text-ink [font-variant-numeric:tabular-nums]">
            {valorUnico(bloco)!.valor}
          </span>
          <span className="mt-1 text-[11px] text-ink-subtle">{valorUnico(bloco)!.rotulo}</span>
        </div>
      )}

      {formato === "grafico" && bloco.chart && bloco.result && (
        <ResultChart spec={bloco.chart} result={bloco.result} />
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
        <p className="line-clamp-2 text-[11.5px] leading-snug text-ink-muted">{bloco.text}</p>
      )}

      {/* ---- o detalhe, atrás de um clique ---- */}
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="mt-auto flex items-center gap-1 self-start pt-1 text-[11px] text-ink-subtle transition-colors duration-150 hover:text-accent"
      >
        <ChevronDown
          aria-hidden
          className={cn("h-3 w-3 transition-transform duration-150", aberto && "rotate-180")}
        />
        {aberto ? "menos" : "detalhe"}
      </button>

      {aberto && (
        <div className="space-y-2.5 border-t border-line pt-2.5">
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
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink">{bloco.text}</p>
          )}
          {bloco.assumptions.length > 0 && (
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              <span className="font-medium">Suposições:</span> {bloco.assumptions.join(" · ")}
            </p>
          )}
          {bloco.sql && <SqlBlock sql={bloco.sql} />}
          {bloco.result && formato !== "tabela" && <ResultTable result={bloco.result} />}
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
            placeholder="Por que este bloco importa para a investigação?"
            className="block w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] leading-relaxed text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent"
          />
        </div>
      )}
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
