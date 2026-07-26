import { ArrowUp, Bookmark, Loader2, MessagesSquare } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ResultChart } from "@/components/result/ResultChart";
import { ResultTable } from "@/components/result/ResultTable";
import { SqlBlock } from "@/components/result/SqlBlock";
import { askInTheme, BackendOffline, pinBlock } from "@/lib/api";
import type { ChartSpec, QueryResult, Theme, Turn } from "@/lib/types";

interface Rodada {
  pergunta: string;
  texto: string;
  sql: string | null;
  resultado: QueryResult | null;
  chart: ChartSpec | null;
  suposicoes: string[];
  erro: string | null;
  pronta: boolean;
  fixada: boolean;
}

const HISTORICO = 3;

/**
 * O chat que enxerga o tema.
 *
 * É o que separa investigação de pasta: aqui "e como isso se divide por sexo?"
 * herda o recorte de covid dos blocos já fixados, em vez de contar as 144
 * milhões de internações. O contexto é montado no servidor — ver
 * src/themes/contexto.py — e só alcança a geração de SQL, nunca a redação da
 * resposta.
 */
export function ThemeChat({ tema, onFixou }: { tema: Theme; onFixou: () => void }) {
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const historico = useRef<Turn[]>([]);
  const fim = useRef<HTMLDivElement>(null);

  const atualiza = useCallback((i: number, fn: (r: Rodada) => Rodada) => {
    setRodadas((rs) => rs.map((r, j) => (j === i ? fn(r) : r)));
  }, []);

  const enviar = useCallback(async () => {
    const pergunta = texto.trim();
    if (!pergunta || ocupado) return;
    setTexto("");
    setOcupado(true);

    const i = rodadas.length;
    setRodadas((rs) => [
      ...rs,
      {
        pergunta,
        texto: "",
        sql: null,
        resultado: null,
        chart: null,
        suposicoes: [],
        erro: null,
        pronta: false,
        fixada: false,
      },
    ]);

    try {
      for await (const ev of askInTheme(tema.id, pergunta, { history: historico.current })) {
        switch (ev.type) {
          case "sql":
            atualiza(i, (r) => ({ ...r, sql: ev.sql }));
            break;
          case "result":
            atualiza(i, (r) => ({ ...r, resultado: ev.result }));
            break;
          case "chart":
            atualiza(i, (r) => ({ ...r, chart: ev.chart }));
            break;
          case "assumptions":
            atualiza(i, (r) => ({ ...r, suposicoes: ev.assumptions }));
            break;
          case "token":
            atualiza(i, (r) => ({ ...r, texto: r.texto + ev.text }));
            break;
          case "failure":
            atualiza(i, (r) => ({ ...r, erro: ev.message, pronta: true }));
            break;
          case "done":
            atualiza(i, (r) => {
              if (r.sql) {
                historico.current = [
                  ...historico.current,
                  { question: pergunta, sql: r.sql },
                ].slice(-HISTORICO);
              }
              return { ...r, pronta: true };
            });
            break;
        }
        fim.current?.scrollIntoView({ block: "end" });
      }
    } catch (e) {
      const offline = e instanceof BackendOffline;
      atualiza(i, (r) => ({
        ...r,
        pronta: true,
        erro: offline ? "O backend não respondeu." : String(e),
      }));
    } finally {
      setOcupado(false);
    }
  }, [atualiza, ocupado, rodadas.length, tema.id, texto]);

  async function fixar(i: number) {
    const r = rodadas[i];
    // `fixada` já vira true antes da chamada: sem isso, dois cliques rápidos
    // gravam o mesmo bloco duas vezes, e o tema fica com evidência repetida.
    if (!r.resultado || r.fixada) return;
    atualiza(i, (x) => ({ ...x, fixada: true }));
    await pinBlock(tema.id, {
      kind: "consulta",
      provenance: "banco",
      title: r.chart?.title || r.pergunta.slice(0, 80),
      question: r.pergunta,
      text: r.texto,
      sql: r.sql,
      result: r.resultado,
      chart: r.chart,
      assumptions: r.suposicoes,
    });
    onFixou();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <MessagesSquare aria-hidden className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[12.5px] font-semibold text-ink">Perguntar neste tema</h2>
          <p className="text-[11px] leading-snug text-ink-subtle">
            {tema.blockCount > 0
              ? `As perguntas enxergam os ${tema.blockCount} bloco(s) já fixados`
              : "Fixe um bloco para as perguntas ganharem contexto"}
            {tema.definitions.length > 0 && ` · ${tema.definitions.length} definição(ões)`}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {rodadas.length === 0 && (
          <p className="px-1 py-8 text-center text-[12px] leading-relaxed text-ink-subtle">
            Pergunte como no chat normal. A diferença é que aqui
            <br />
            &ldquo;e por sexo?&rdquo; sabe do que você está falando.
          </p>
        )}

        <div className="space-y-4">
          {rodadas.map((r, i) => (
            <div key={i} className="space-y-2">
              <p className="rounded-lg bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-ink">
                {r.pergunta}
              </p>

              {r.erro ? (
                <p className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] text-ink">
                  {r.erro}
                </p>
              ) : (
                <>
                  {r.texto ? (
                    <p className="whitespace-pre-wrap px-1 text-[12.5px] leading-relaxed text-ink">
                      {r.texto}
                    </p>
                  ) : (
                    !r.pronta && (
                      <Loader2
                        aria-hidden
                        className="mx-1 h-4 w-4 animate-spin text-ink-subtle"
                      />
                    )
                  )}
                  {r.chart && r.resultado && (
                    <ResultChart spec={r.chart} result={r.resultado} />
                  )}
                  {r.sql && <SqlBlock sql={r.sql} />}
                  {r.resultado && <ResultTable result={r.resultado} />}

                  {r.pronta && r.resultado && (
                    <button
                      onClick={() => void fixar(i)}
                      disabled={r.fixada}
                      className={
                        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] " +
                        "transition-colors duration-150 " +
                        (r.fixada
                          ? "border-accent/40 bg-accent-soft text-accent"
                          : "border-line text-ink-muted hover:border-accent/40 hover:text-accent")
                      }
                    >
                      <Bookmark aria-hidden className="h-3.5 w-3.5" />
                      {r.fixada ? "fixado neste tema" : "fixar neste tema"}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <div ref={fim} />
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-accent">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            placeholder="e por sexo? e por região?"
            aria-label="Pergunta no tema"
            className="min-h-[1.5rem] flex-1 resize-none bg-transparent text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            onClick={() => void enviar()}
            disabled={!texto.trim() || ocupado}
            aria-label="Enviar"
            className="shrink-0 rounded-lg bg-accent p-1.5 text-white transition-opacity duration-150 disabled:opacity-40"
          >
            {ocupado ? (
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
