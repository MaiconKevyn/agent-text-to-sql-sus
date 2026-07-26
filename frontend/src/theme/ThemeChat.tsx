import { ArrowUp, Bookmark, Globe, Loader2, MessagesSquare } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { TextoComCitacoes } from "@/components/theme/TextoComCitacoes";
import { ResultChart } from "@/components/result/ResultChart";
import { ResultTable } from "@/components/result/ResultTable";
import { SqlBlock } from "@/components/result/SqlBlock";
import { askInTheme, BackendOffline, pinBlock } from "@/lib/api";
import type { ChartSpec, QueryResult, SearchCandidate, Theme, Turn } from "@/lib/types";

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
  // Quando a pergunta foi (também) para fora do banco.
  buscando: boolean;
  buscaConsulta: string;
  candidatos: SearchCandidate[] | null;
  buscaErro: string | null;
  // URLs já fixadas nesta rodada — o botão de cada candidato lembra do clique.
  fixados: string[];
  /** A resposta veio dos blocos do tema, e não de uma consulta nova. */
  doTema: boolean;
  /** Espera enquanto o tema é lido — curta, mas não instantânea. */
  lendoTema: boolean;
  /** O tema foi tentado e não bastou — a pergunta seguiu para o banco. */
  temaNaoBastou: string;
}

const RODADA_VAZIA: Omit<Rodada, "pergunta"> = {
  texto: "",
  sql: null,
  resultado: null,
  chart: null,
  suposicoes: [],
  erro: null,
  pronta: false,
  fixada: false,
  buscando: false,
  buscaConsulta: "",
  candidatos: null,
  buscaErro: null,
  fixados: [],
  doTema: false,
  lendoTema: false,
  temaNaoBastou: "",
};

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
    setRodadas((rs) => [...rs, { pergunta, ...RODADA_VAZIA }]);

    try {
      for await (const ev of askInTheme(tema.id, pergunta, { history: historico.current })) {
        switch (ev.type) {
          case "route":
            // Só quando vai MESMO à web. Escrito como `!== "banco"` quando os
            // destinos eram três, isto passou a anunciar "buscando em fontes
            // oficiais" para uma resposta tirada do próprio tema.
            if (ev.destination === "web" || ev.destination === "ambos") {
              atualiza(i, (r) => ({ ...r, buscando: true, buscaConsulta: ev.query }));
            }
            if (ev.destination === "tema") {
              atualiza(i, (r) => ({ ...r, lendoTema: true }));
            }
            break;
          case "search":
            atualiza(i, (r) => ({ ...r, buscando: false, candidatos: ev.candidates }));
            break;
          case "theme_answer":
            atualiza(i, (r) => ({ ...r, doTema: true, lendoTema: false }));
            break;
          case "theme_miss":
            atualiza(i, (r) => ({ ...r, lendoTema: false }));
            // Vale mostrar: sem isto, a pergunta some por dois segundos e volta
            // como consulta ao banco sem explicar por quê.
            atualiza(i, (r) => ({ ...r, temaNaoBastou: ev.reason }));
            break;
          case "search_failed":
            atualiza(i, (r) => ({ ...r, buscando: false, buscaErro: ev.message }));
            break;
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
              return { ...r, pronta: true, buscando: false, lendoTema: false };
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

  /**
   * Fixa um achado da web como citação.
   *
   * O trecho vai LITERAL, com URL e data de acesso — é o mesmo bloco que o
   * formulário manual produz. Trocar a origem do conteúdo não muda o bloco nem
   * o relatório; muda só quanto trabalho a pessoa teve para chegar nele.
   */
  async function fixarAchado(i: number, c: SearchCandidate) {
    if (rodadas[i].fixados.includes(c.url)) return;
    atualiza(i, (x) => ({ ...x, fixados: [...x.fixados, c.url] }));
    await pinBlock(tema.id, {
      kind: "nota",
      provenance: "web",
      title: c.title || c.domain,
      text: c.excerpt,
      sourceUrl: c.url,
      sourceTitle: c.title,
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
          <div className="space-y-3 px-1 py-8 text-center text-[12px] leading-relaxed text-ink-subtle">
            <p>
              Pergunte como no chat normal. A diferença é que aqui
              <br />
              &ldquo;e por sexo?&rdquo; sabe do que você está falando.
            </p>
            <p className="text-[11.5px]">
              Para sair do banco, peça: &ldquo;busque na internet sobre&hellip;&rdquo;
            </p>
          </div>
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
                  {/* O que veio de fora do banco, antes da resposta do banco:
                      em "ambos", a busca chega primeiro. */}
                  {r.lendoTema && !r.doTema && (
                    <p className="flex items-center gap-1.5 px-1 text-[11.5px] text-ink-muted">
                      <Bookmark aria-hidden className="h-3.5 w-3.5 animate-pulse text-accent" />
                      lendo o que já está fixado neste tema
                    </p>
                  )}
                  {r.buscando && (
                    <p className="flex items-center gap-1.5 px-1 text-[11.5px] text-ink-muted">
                      <Globe aria-hidden className="h-3.5 w-3.5 animate-pulse text-caution" />
                      buscando em fontes oficiais: {r.buscaConsulta}
                    </p>
                  )}
                  {r.buscaErro && (
                    <p className="rounded-lg bg-caution-soft px-3 py-2 text-[11.5px] text-ink-muted">
                      {r.buscaErro}
                    </p>
                  )}
                  {r.candidatos?.length === 0 && (
                    <p className="px-1 text-[11.5px] text-ink-muted">
                      Nada encontrado nos domínios permitidos para &ldquo;{r.buscaConsulta}
                      &rdquo;.
                    </p>
                  )}
                  {r.candidatos && r.candidatos.length > 0 && (
                    <div className="space-y-1.5 rounded-lg border border-caution/25 bg-caution-soft px-2.5 py-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                        <Globe aria-hidden className="h-3.5 w-3.5 text-caution" />
                        {r.candidatos.length} achado(s) fora do banco &middot; fixe o que
                        interessar
                      </p>
                      {r.candidatos.map((c) => {
                        const fixado = r.fixados.includes(c.url);
                        return (
                          <div
                            key={c.url}
                            className="rounded-lg border border-line bg-surface px-2.5 py-2"
                          >
                            <div className="flex items-baseline gap-2">
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink underline decoration-dotted underline-offset-2 hover:text-accent"
                              >
                                {c.title}
                              </a>
                              <span className="shrink-0 text-[10.5px] text-ink-subtle">
                                {c.domain}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-ink-muted">
                              {c.excerpt}
                            </p>
                            <button
                              onClick={() => void fixarAchado(i, c)}
                              disabled={fixado}
                              className={
                                "mt-1.5 flex items-center gap-1 rounded-md border px-2 py-0.5 " +
                                "text-[11px] transition-colors duration-150 " +
                                (fixado
                                  ? "border-accent/40 bg-accent-soft text-accent"
                                  : "border-line text-ink-muted hover:border-accent/40 hover:text-accent")
                              }
                            >
                              <Bookmark aria-hidden className="h-3 w-3" />
                              {fixado ? "fixado" : "fixar como citação"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {r.doTema && (
                    <p className="flex items-center gap-1.5 px-1 text-[11px] text-ink-muted">
                      <Bookmark aria-hidden className="h-3 w-3 text-accent" />
                      respondido com o que já está fixado neste tema
                    </p>
                  )}
                  {r.temaNaoBastou && (
                    <p className="px-1 text-[11px] leading-snug text-ink-subtle">
                      O tema não respondia: {r.temaNaoBastou} — consultando o banco.
                    </p>
                  )}
                  {r.texto ? (
                    r.doTema ? (
                      <TextoComCitacoes texto={r.texto} blocos={tema.blocks ?? []} />
                    ) : (
                      <p className="whitespace-pre-wrap px-1 text-[12.5px] leading-relaxed text-ink">
                        {r.texto}
                      </p>
                    )
                  ) : (
                    // Sem o `!r.buscando`, uma pergunta que foi para a web
                    // mostra dois indicadores de espera dizendo a mesma coisa.
                    !r.pronta &&
                    !r.buscando &&
                    !r.lendoTema && (
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
