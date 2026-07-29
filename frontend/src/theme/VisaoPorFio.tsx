import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SeloDePapel } from "@/components/theme/PapelDoAchado";
import { SourceBadge } from "@/components/theme/SourceBadge";
import { classifyBlock, createThread, deleteThread } from "@/lib/api";
import type { Theme, ThemeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  tema: Theme;
  onMudou: () => void;
}

/**
 * O tema agrupado por linha de investigação.
 *
 * É uma visão DIFERENTE do quadro, não uma reorganização dele — e a diferença é
 * o que ela serve. O quadro livre serve para explorar: cada achado tem o tamanho
 * que se deu a ele, o gráfico ocupa o espaço que merece, e a posição na tela é
 * uma decisão de quem investiga. Aqui não há tamanho nem posição: há a ordem do
 * ARGUMENTO — o que cada fio tenta estabelecer e o que cada achado faz dentro
 * dele.
 *
 * Por isso o card daqui é curto de propósito. Quem quer ver o gráfico volta ao
 * quadro; quem está nesta tela está lendo se o argumento fecha, e para isso o
 * que importa é o papel, o peso e a frase do "por que importa".
 */
export function VisaoPorFio({ tema, onMudou }: Props) {
  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const blocos = tema.blocks ?? [];

  // "Sem fio" vai por ÚLTIMO e só aparece quando tem alguém: num tema que
  // ninguém organizou, um cabeçalho "sem fio" acima de tudo seria uma acusação
  // no lugar onde deveria estar o conteúdo.
  const grupos: { fio: { id: string; title: string; summary: string } | null; itens: ThemeBlock[] }[] = [
    ...tema.threads.map((f) => ({ fio: f, itens: blocos.filter((b) => b.thread === f.id) })),
    { fio: null, itens: blocos.filter((b) => !b.thread || !tema.threads.some((f) => f.id === b.thread)) },
  ].filter((g) => g.fio !== null || g.itens.length > 0);

  async function novoFio() {
    if (titulo.trim().length < 2) return;
    await createThread(tema.id, titulo.trim());
    setTitulo("");
    setCriando(false);
    onMudou();
  }

  return (
    <div className="space-y-5">
      {grupos.map(({ fio, itens }) => (
        <section key={fio?.id ?? "soltos"}>
          <div className="mb-1.5 flex items-baseline gap-2">
            <h3
              className={cn(
                "text-[12.5px] font-semibold",
                fio ? "text-ink" : "text-ink-subtle",
              )}
            >
              {fio ? fio.title : "Sem fio"}
            </h3>
            <span className="text-[11px] text-ink-subtle">
              {itens.length} achado{itens.length === 1 ? "" : "s"}
              {contar(itens, "contradiz") > 0 && (
                <span className="text-caution"> · {contar(itens, "contradiz")} contradiz</span>
              )}
              {itens.filter((b) => b.weight === "material").length > 0 &&
                ` · ${itens.filter((b) => b.weight === "material").length} material`}
            </span>
            {fio && (
              <button
                onClick={async () => {
                  await deleteThread(tema.id, fio.id);
                  onMudou();
                }}
                aria-label={`Apagar o fio ${fio.title}`}
                title="Apaga o fio e solta os achados — nenhum achado é perdido"
                className="ml-auto rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-critical"
              >
                <Trash2 aria-hidden className="h-3 w-3" />
              </button>
            )}
          </div>

          {itens.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[11.5px] text-ink-subtle">
              Nenhum achado neste fio ainda. Mova um pelo seletor de fio de cada card.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {itens.map((b) => (
                <li
                  key={b.id}
                  className={cn(
                    "rounded-lg border bg-surface px-3 py-2",
                    b.role === "contradiz" ? "border-caution/60" : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                      {b.title || b.question}
                    </span>
                    <SeloDePapel papel={b.role} peso={b.weight} compacto />
                    <SourceBadge provenance={b.provenance} />
                    {/* O seletor de fio fica no achado, e não numa tela de
                        arrastar: mudar de fio é uma decisão sobre o argumento,
                        e ela se toma olhando o achado. */}
                    <select
                      value={b.thread}
                      onChange={async (e) => {
                        await classifyBlock(tema.id, b.id, { thread: e.target.value });
                        onMudou();
                      }}
                      aria-label={`Fio de ${b.title || b.question}`}
                      className="rounded border border-line bg-canvas px-1 py-0.5 text-[10.5px] text-ink-muted outline-none focus:border-accent"
                    >
                      <option value="">— sem fio —</option>
                      {tema.threads.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  {b.why ? (
                    <p className="mt-1 border-l-2 border-accent pl-2 text-[11px] leading-snug text-ink-muted">
                      {b.why}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      sem &ldquo;por que importa&rdquo; — este achado ainda não entra no argumento
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {criando ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void novoFio();
              if (e.key === "Escape") setCriando(false);
            }}
            placeholder="O que este fio tenta estabelecer?"
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
          />
          <button
            onClick={novoFio}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
          >
            Criar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCriando(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[12px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Novo fio
        </button>
      )}
    </div>
  );
}

function contar(itens: ThemeBlock[], papel: string) {
  return itens.filter((b) => b.role === papel).length;
}
