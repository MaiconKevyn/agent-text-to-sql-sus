import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { ResultTable } from "@/components/result/ResultTable";
import { SqlBlock } from "@/components/result/SqlBlock";
import { SeloDePapel } from "@/components/theme/PapelDoAchado";
import { TextoComCitacoes } from "@/components/theme/TextoComCitacoes";
import { answerQuestion, deleteQuestion } from "@/lib/api";
import type { Theme, ThemeBlock, ThemeQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

type Aba = "resposta" | "tabelas" | "achados" | "diagnostico";

/**
 * Uma pergunta de trabalho, com tudo que a resposta dela precisa para ser
 * conferida.
 *
 * As quatro abas não são organização de conteúdo — são as quatro perguntas que
 * alguém faz a uma síntese, na ordem em que faz: o que você concluiu, com que
 * números, apoiado em quê, e o que você deixou de fora. A última é a que não
 * existia em lugar nenhum: a escolha do modelo sobre o que ignorar era
 * invisível, e uma escolha invisível não pode ser contestada.
 */
export function PerguntaDoTema({
  pergunta,
  tema,
  onMudou,
}: {
  pergunta: ThemeQuestion;
  tema: Theme;
  onMudou: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [aba, setAba] = useState<Aba>("resposta");
  const [rodando, setRodando] = useState(false);
  const [recusa, setRecusa] = useState("");

  const blocos = tema.blocks ?? [];
  const citados = pergunta.cited
    .map((id) => blocos.find((b) => b.id === id))
    .filter((b): b is ThemeBlock => Boolean(b));
  const materiais = citados.filter((b) => b.weight === "material").length;
  const respondida = Boolean(pergunta.answeredAt);

  async function responder() {
    setRodando(true);
    setRecusa("");
    const r = await answerQuestion(tema.id, pergunta.id);
    setRodando(false);
    if (r.refused) setRecusa(r.refused);
    else {
      setAberta(true);
      onMudou();
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-surface",
        pergunta.stale ? "border-caution/60" : "border-line",
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <button
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block text-[12.5px] leading-snug text-ink">{pergunta.text}</span>
          <span className="mt-0.5 block text-[10.5px] text-ink-subtle">
            {respondida ? (
              <>
                {citados.length} achado{citados.length === 1 ? "" : "s"} citado
                {citados.length === 1 ? "" : "s"}
                {materiais > 0 && ` · ${materiais} material${materiais === 1 ? "" : "is"}`}
                {pergunta.discarded.length > 0 && ` · ${pergunta.discarded.length} descartado(s)`}
              </>
            ) : (
              "sem resposta ainda"
            )}
          </span>
        </button>

        {/* O alerta de refazer é o único frescor honesto numa base fechada: não
            diz que o dado mudou — diz que o RECORTE conferido mudou. */}
        {pergunta.stale && (
          <span
            className="flex shrink-0 items-center gap-1 rounded border border-caution/40 bg-caution-soft px-1.5 py-px text-[10px] text-caution"
            title="As definições do tema mudaram depois que esta resposta foi produzida"
          >
            <AlertTriangle aria-hidden className="h-3 w-3" />
            definição mudou
          </span>
        )}

        <button
          onClick={responder}
          disabled={rodando}
          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent disabled:opacity-40"
        >
          {rodando ? (
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          ) : respondida ? (
            "refazer"
          ) : (
            "responder"
          )}
        </button>
        <button
          onClick={async () => {
            await deleteQuestion(tema.id, pergunta.id);
            onMudou();
          }}
          aria-label={`Apagar a pergunta ${pergunta.text}`}
          title="Apaga a pergunta. Os achados que ela cita ficam — eles são do tema."
          className="shrink-0 rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-critical"
        >
          <Trash2 aria-hidden className="h-3 w-3" />
        </button>
      </div>

      {recusa && (
        <p className="mx-3 mb-2 rounded bg-caution-soft px-2 py-1 text-[11px] leading-relaxed text-ink">
          {recusa}
        </p>
      )}

      {aberta && respondida && (
        <>
          <div className="flex gap-0.5 border-y border-line bg-raised px-2">
            {(
              [
                ["resposta", "Resposta"],
                ["tabelas", `Tabelas · ${citados.filter((b) => b.result).length}`],
                ["achados", `Achados · ${citados.length}`],
                ["diagnostico", "Diagnóstico"],
              ] as const
            ).map(([id, rot]) => (
              <button
                key={id}
                onClick={() => setAba(id)}
                aria-current={aba === id}
                className={cn(
                  "border-b-2 px-2 py-1.5 text-[10.5px] transition-colors duration-150",
                  aba === id
                    ? "border-accent font-semibold text-accent"
                    : "border-transparent text-ink-subtle hover:text-ink",
                )}
              >
                {rot}
              </button>
            ))}
          </div>

          <div className="px-3 py-2.5">
            {aba === "resposta" && (
              <>
                <TextoComCitacoes texto={pergunta.answer} blocos={blocos} />
                {/* A conta de apoio: é ela que dá sentido ao peso "material". */}
                <p className="mt-2 border-t border-line pt-1.5 text-[10.5px] text-ink-subtle">
                  {materiais > 0
                    ? `Apoio: ${materiais} achado${materiais === 1 ? "" : "s"} material${materiais === 1 ? "" : "is"}. Se ${materiais === 1 ? "ele cair" : "um deles cair"}, a conclusão muda.`
                    : "Nenhum achado citado está marcado como material — o apoio desta conclusão não foi avaliado."}
                </p>
              </>
            )}

            {aba === "tabelas" &&
              (citados.filter((b) => b.result).length === 0 ? (
                <p className="text-[11.5px] text-ink-subtle">
                  Nenhum achado citado tem tabela — a resposta se apoia em texto e citação.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {citados
                    .filter((b) => b.result)
                    .map((b) => (
                      <div key={b.id}>
                        <p className="mb-1 text-[11px] font-medium text-ink">
                          {b.title || b.question}
                        </p>
                        <ResultTable result={b.result!} />
                      </div>
                    ))}
                </div>
              ))}

            {aba === "achados" && (
              <ul className="space-y-1.5">
                {citados.map((b) => (
                  <li key={b.id} className="rounded border border-line px-2 py-1.5">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                        {b.title || b.question}
                      </span>
                      <SeloDePapel papel={b.role} peso={b.weight} compacto />
                    </div>
                    {b.why && (
                      <p className="mt-1 border-l-2 border-accent pl-2 text-[10.5px] leading-snug text-ink-muted">
                        {b.why}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {aba === "diagnostico" && (
              <div className="space-y-2.5">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
                    Definições em vigor quando esta resposta saiu
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                    {pergunta.definitionsUsed || "nenhuma — o tema não tinha definições"}
                  </p>
                  {pergunta.stale && (
                    <p className="mt-1 rounded bg-caution-soft px-2 py-1 text-[10.5px] leading-relaxed text-ink">
                      As definições do tema mudaram desde então. O número desta resposta continua
                      sendo o que o banco devolveu — mas sob um recorte que não é mais o que está
                      em vigor.
                    </p>
                  )}
                </div>

                {/* O que a resposta NÃO usou. É a peça que responde à pergunta
                    que ninguém consegue fazer a uma síntese. */}
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
                    O que a resposta não usou · {pergunta.discarded.length}
                  </p>
                  {pergunta.discarded.length === 0 ? (
                    <p className="mt-0.5 text-[11px] text-ink-subtle">
                      Nada foi descartado com justificativa.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {pergunta.discarded.map((d) => {
                        const b = blocos.find((x) => x.id === d.bloco);
                        return (
                          <li
                            key={d.bloco}
                            className="rounded border border-dashed border-line px-2 py-1 text-[10.5px] leading-snug"
                          >
                            <span className="font-medium text-ink">
                              {b ? b.title || b.question : d.bloco}
                            </span>
                            <span className="text-ink-subtle"> — {d.motivo}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {citados.some((b) => b.sql) && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
                      SQL dos achados citados
                    </p>
                    {citados
                      .filter((b) => b.sql)
                      .map((b) => (
                        <SqlBlock key={b.id} sql={b.sql!} />
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
