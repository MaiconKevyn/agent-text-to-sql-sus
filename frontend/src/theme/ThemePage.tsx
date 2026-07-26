import { ArrowLeft, Bookmark, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ResultChart } from "@/components/result/ResultChart";
import { ResultTable } from "@/components/result/ResultTable";
import { SqlBlock } from "@/components/result/SqlBlock";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/hooks/useTheme";
import {
  createTheme,
  listThemes,
  noteBlock,
  readTheme,
  unpinBlock,
} from "@/lib/api";
import type { Theme, ThemeBlock } from "@/lib/types";

const nf = new Intl.NumberFormat("pt-BR");

/** O id do tema aberto vem da URL — assim um tema é compartilhável por link. */
function idDaUrl(): string | null {
  return new URLSearchParams(location.search).get("tema");
}

function abrir(id: string | null) {
  const u = new URL(location.href);
  if (id) u.searchParams.set("tema", id);
  else u.searchParams.delete("tema");
  history.pushState({}, "", u);
  // A rota é lida no carregamento; um evento avisa quem está montado.
  dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * A tela do tema: uma aba separada do chat, de propósito.
 *
 * O chat é efêmero e limpar a conversa é normal; o tema existe para não perder
 * nada. São ciclos de vida opostos, e o layout também: chat é uma coluna com
 * foco no último item, investigação é material que se compara lado a lado.
 */
export default function ThemePage() {
  const { theme, toggle } = useTheme();
  const [id, setId] = useState<string | null>(idDaUrl);
  const [lista, setLista] = useState<Theme[]>([]);
  const [tema, setTema] = useState<Theme | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoVoltar = () => setId(idDaUrl());
    addEventListener("popstate", aoVoltar);
    return () => removeEventListener("popstate", aoVoltar);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      if (id) setTema(await readTheme(id));
      else setLista(await listThemes());
    } catch (e) {
      setErro(String(e));
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function novo() {
    const t = await createTheme("Nova investigação");
    abrir(t.id);
  }

  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 px-5 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <a
            href={id ? "?" : "/"}
            onClick={(e) => {
              if (!id) return;
              e.preventDefault();
              abrir(null);
            }}
            className="flex items-center gap-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {id ? "Temas" : "Voltar ao chat"}
          </a>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-ink">
              {tema && id ? tema.title : "Investigações"}
            </h1>
            {tema && id && (
              <p className="text-[11.5px] text-ink-subtle">
                {tema.blockCount} bloco{tema.blockCount === 1 ? "" : "s"}
                {tema.definitions.length > 0 &&
                  ` · ${tema.definitions.length} definição(ões) do tema`}
              </p>
            )}
          </div>
          <button
            onClick={toggle}
            className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            {theme === "dark" ? "Tema claro" : "Tema escuro"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-6">
        {carregando && (
          <div className="flex justify-center py-16 text-ink-subtle">
            <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
          </div>
        )}

        {erro && (
          <p className="rounded-xl bg-critical-soft px-4 py-3 text-[13px] text-ink">{erro}</p>
        )}

        {!carregando && !erro && !id && (
          <ListaDeTemas temas={lista} onNovo={novo} />
        )}

        {!carregando && !erro && id && tema && (
          <DetalheDoTema tema={tema} onMudou={carregar} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function ListaDeTemas({ temas, onNovo }: { temas: Theme[]; onNovo: () => void }) {
  if (temas.length === 0) {
    return (
      <div className="py-16 text-center">
        <Bookmark aria-hidden className="mx-auto mb-3 h-7 w-7 text-ink-subtle" />
        <h2 className="text-[15px] font-semibold text-ink">Nenhuma investigação ainda</h2>
        <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-muted">
          Um tema junta as respostas que você quer guardar sobre um assunto. No chat,
          use <span className="font-medium">fixar num tema</span> abaixo de qualquer
          resposta — ou comece um vazio aqui.
        </p>
        <button
          onClick={onNovo}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Criar uma investigação
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-ink">
          {temas.length} investigação{temas.length === 1 ? "" : "ões"}
        </h2>
        <button
          onClick={onNovo}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Nova
        </button>
      </div>
      <ul className="space-y-2">
        {temas.map((t) => (
          <li key={t.id}>
            <a
              href={`?tema=${t.id}`}
              onClick={(e) => {
                e.preventDefault();
                abrir(t.id);
              }}
              className="flex items-baseline gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors duration-150 hover:border-accent/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">{t.title}</span>
                {t.description && (
                  <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                    {t.description}
                  </span>
                )}
              </span>
              <Badge tone="neutral">
                {t.blockCount} bloco{t.blockCount === 1 ? "" : "s"}
              </Badge>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function DetalheDoTema({ tema, onMudou }: { tema: Theme; onMudou: () => void }) {
  const blocos = tema.blocks ?? [];

  return (
    <>
      {tema.definitions.length > 0 && (
        <section className="mb-5 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3">
          <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
            Definições deste tema
          </h2>
          {/* A definição vive no tema e não no bloco: você confere o recorte de
              "covid" uma vez e toda pergunta do tema herda o mesmo. */}
          <ul className="space-y-1">
            {tema.definitions.map((d) => (
              <li key={d.term} className="text-[12px] leading-relaxed text-ink">
                <span className="font-medium">{d.term}</span>
                <span className="text-ink-muted"> — {d.clause}</span>
                {d.total > 0 && (
                  <span className="text-ink-subtle"> · {nf.format(d.total)} internações</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {blocos.length === 0 ? (
        <div className="py-16 text-center">
          <FileText aria-hidden className="mx-auto mb-3 h-7 w-7 text-ink-subtle" />
          <p className="text-[13px] text-ink-muted">
            Ainda sem blocos. Volte ao chat, faça uma pergunta e use{" "}
            <span className="font-medium">fixar num tema</span>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {blocos.map((b, i) => (
            <BlocoFixado
              key={b.id}
              bloco={b}
              indice={i + 1}
              temaId={tema.id}
              onMudou={onMudou}
            />
          ))}
        </div>
      )}
    </>
  );
}

function BlocoFixado({
  bloco,
  indice,
  temaId,
  onMudou,
}: {
  bloco: ThemeBlock;
  indice: number;
  temaId: string;
  onMudou: () => void;
}) {
  const [anotacao, setAnotacao] = useState(bloco.note);
  const [estado, setEstado] = useState<"parado" | "salvando" | "salvo">("parado");

  /**
   * Salva sozinha, 800 ms depois de parar de digitar.
   *
   * Salvar só no `blur` perde a anotação de quem digita e fecha a aba — e é
   * justamente o texto mais caro de reescrever, porque é a única parte do bloco
   * que não dá para reproduzir rodando a consulta de novo.
   */
  useEffect(() => {
    if (anotacao === bloco.note) return;
    const t = setTimeout(async () => {
      setEstado("salvando");
      try {
        await noteBlock(temaId, bloco.id, anotacao);
        setEstado("salvo");
        onMudou();
      } catch {
        setEstado("parado");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [anotacao, bloco.note, bloco.id, temaId, onMudou]);

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex items-start gap-2.5 border-b border-line px-4 py-2.5">
        <span className="pt-0.5 text-[11px] text-ink-subtle">{indice}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium leading-snug text-ink">
            {bloco.title || bloco.question}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* A procedência é visível desde já, com um valor só. Quando houver
                web e arquivos, o leitor não terá de aprender nada novo. */}
            <Badge tone={bloco.provenance === "banco" ? "neutral" : "caution"}>
              {bloco.provenance === "banco" ? "do banco" : bloco.provenance}
            </Badge>
            {bloco.result && (
              <Badge tone="neutral">{nf.format(bloco.result.nRows)} linhas</Badge>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            await unpinBlock(temaId, bloco.id);
            onMudou();
          }}
          aria-label="Remover do tema"
          className="rounded-lg p-1 text-ink-subtle transition-colors duration-150 hover:bg-raised hover:text-critical"
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="space-y-2.5 px-4 py-3">
        {bloco.definition && (
          <div className="rounded-lg bg-raised px-3 py-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-subtle">
              O que foi medido
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{bloco.definition}</p>
          </div>
        )}

        {bloco.text && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{bloco.text}</p>
        )}

        {bloco.chart && bloco.result && (
          <ResultChart spec={bloco.chart} result={bloco.result} />
        )}
        {bloco.sql && <SqlBlock sql={bloco.sql} />}
        {bloco.result && <ResultTable result={bloco.result} />}

        {/* A anotação é o que separa uma coleção de consultas de uma
            investigação: registra por que este bloco está aqui. */}
        <textarea
          value={anotacao}
          onChange={(e) => setAnotacao(e.target.value)}
          rows={2}
          placeholder="Por que este bloco importa para a investigação?"
          className="block w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent"
        />
        {estado !== "parado" && (
          <p className="text-[11px] text-ink-subtle">
            {estado === "salvando" ? "salvando…" : "anotação salva"}
          </p>
        )}
      </div>
    </article>
  );
}
