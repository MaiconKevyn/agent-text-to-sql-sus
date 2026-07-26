import { ArrowLeft, Bookmark, FileText, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SeletorDePaleta } from "@/components/SeletorDePaleta";
import { TrilhoDeSecoes } from "@/components/TrilhoDeSecoes";
import {
  createTheme,
  listThemes,
  readTheme,
  setGrid,
  setPalette,
} from "@/lib/api";
import { PaletaEscopo } from "@/hooks/usePaleta";
import { useIsDark } from "@/hooks/useTheme";
import { aplicarPaleta, limparPaleta } from "@/lib/paletas";
import { LINHA_PX, VAO_PX, type Theme, type ThemeBlock } from "@/lib/types";
import { ThemeChat } from "./ThemeChat";
import { AddSource } from "@/components/theme/AddSource";
import { BlocoPainel } from "./BlocoPainel";
import { usePainel } from "./usePainel";

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

  /**
   * `primeira` distingue abrir a tela de recarregar depois de uma mudança.
   *
   * Sem essa distinção, fixar uma resposta ligava `carregando`, o que desmontava
   * a subárvore inteira — e junto dela o chat do tema, apagando a conversa que
   * acabara de produzir o bloco. Recarregar tem de ser silencioso.
   */
  const carregar = useCallback(
    async (primeira = false) => {
      if (primeira) setCarregando(true);
      setErro(null);
      try {
        if (id) setTema(await readTheme(id));
        else setLista(await listThemes());
      } catch (e) {
        setErro(String(e));
      } finally {
        setCarregando(false);
      }
    },
    [id],
  );

  const recarregar = useCallback(() => void carregar(), [carregar]);

  useEffect(() => {
    void carregar(true);
  }, [carregar]);

  async function novo() {
    const t = await createTheme("Nova investigação");
    abrir(t.id);
  }

  // A paleta do tema vale só dentro desta tela: os tokens vão no contêiner e
  // cascateiam, e o id desce pelo contexto porque o ECharts não lê CSS.
  const raiz = useRef<HTMLDivElement>(null);
  const paletaDoTema = tema?.palette ?? "";
  const escura = useIsDark();
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    if (paletaDoTema) aplicarPaleta(el, paletaDoTema, escura ? "dark" : "light");
    else limparPaleta(el);
  }, [paletaDoTema, escura]);

  return (
    <PaletaEscopo.Provider value={paletaDoTema || null}>
    <div ref={raiz} className="flex min-h-full bg-canvas">
      {/* O trilho é o mesmo do chat, e por isso está aqui: uma coluna que
          "nunca sai" que sumisse ao abrir um tema não seria uma coluna fixa,
          seria uma coluna do chat. Aqui ele navega em vez de abrir lista —
          não há duas listas nesta tela. */}
      <TrilhoDeSecoes
        aba="temas"
        aberto
        onEscolher={(a) => {
          location.href = a === "temas" ? "?temas" : a === "paineis" ? "?paineis" : "/";
        }}
      />
      <div className="min-w-0 flex-1">
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
          {id && tema ? (
            <SeletorDePaleta
              doTema={{ atual: tema.palette ?? "", aoEscolher: async (p) => {
                await setPalette(tema.id, p);
                recarregar();
              } }}
            />
          ) : (
            <SeletorDePaleta />
          )}
        </div>
      </header>

      <main className={id ? "mx-auto max-w-[1500px] px-5 py-6" : "mx-auto max-w-4xl px-5 py-6"}>
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
          <DetalheDoTema tema={tema} onMudou={recarregar} />
        )}
      </main>
      </div>
    </div>
    </PaletaEscopo.Provider>
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
  const painel = usePainel(blocos, (l) => setGrid(tema.id, l), onMudou);

  // Duas colunas no desktop: o material à esquerda, o chat que o enxerga à
  // direita. Em tela estreita eles empilham, com o chat primeiro — de nada
  // adianta o contexto se a caixa de pergunta está no fim de vinte blocos.
  return (
    <div className="flex flex-col gap-5 lg:flex-row-reverse lg:items-start">
      <aside
        aria-label="Perguntar neste tema"
        className="h-[32rem] shrink-0 overflow-hidden rounded-xl border border-line bg-surface lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:w-[26rem]"
      >
        <ThemeChat tema={tema} onFixou={onMudou} />
      </aside>

      <div className="min-w-0 flex-1">
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
        <Palco painel={painel} blocos={blocos} temaId={tema.id} onMudou={onMudou} />
      )}

      <div className="mt-3">
        <AddSource temaId={tema.id} onAdicionou={onMudou} />
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * O palco: os blocos vivem aqui em posição absoluta, sobre uma grade desenhada.
 *
 * A grade de fundo existe para responder a pergunta que se faz enquanto se
 * arrasta — "cabe aqui?". Sem ela o painel é um espaço liso e o encaixe vira
 * tentativa e erro. Fica fraca em repouso, para não competir com o conteúdo, e
 * ganha presença durante o gesto, quando é a informação que importa.
 */
function Palco({
  painel,
  blocos,
  temaId,
  onMudou,
}: {
  painel: ReturnType<typeof usePainel>;
  blocos: ThemeBlock[];
  temaId: string;
  onMudou: () => void;
}) {
  const { palco, medidas, comecar, porTeclado, gesto, alturaDoPalco, larguraDaColuna } = painel;
  const emGesto = gesto !== null;
  const alvo = gesto ? medidas(gesto.id) : null;
  const passo = larguraDaColuna() + VAO_PX;

  return (
    <div
      ref={palco}
      className="relative rounded-lg"
      style={{
        height: alturaDoPalco,
        // A grade fica SEMPRE à vista, não só durante o gesto: ela é a régua do
        // painel. Quem vai fixar um bloco precisa saber, antes de arrastar,
        // quantos quadrados cabem — e uma grade que só aparece com o gesto na
        // mão chega tarde para essa decisão.
        //
        // `hsl(var(--...) / a)` e não o token cru: eles guardam COMPONENTES HSL
        // ("190 82% 27%"), não cores, e passar um direto para um gradiente
        // produz valor inválido — o navegador descarta a declaração inteira em
        // silêncio, sem erro no console.
        //
        // A cor da tinta com alfa, e não a da borda: `--line` é um cinza claro
        // fixo, que no tema escuro vira linha clara sobre fundo claro. A tinta
        // inverte junto com o tema, então a grade tem o mesmo peso nos dois.
        backgroundImage: `linear-gradient(to right, ${emGesto ? "hsl(var(--accent) / 0.32)" : "hsl(var(--ink) / 0.09)"} 1px, transparent 1px),
           linear-gradient(to bottom, ${emGesto ? "hsl(var(--accent) / 0.32)" : "hsl(var(--ink) / 0.09)"} 1px, transparent 1px)`,
        // Uma célula por quadrado: o passo é o mesmo que o de um bloco 1×1, e é
        // isso que permite contar com os olhos quantos cabem numa vaga.
        backgroundSize: `${passo}px ${LINHA_PX + VAO_PX}px`,
        backgroundPosition: "-1px -1px",
        backgroundColor: emGesto ? "hsl(var(--accent) / 0.04)" : undefined,
        transition: "background-color 150ms ease",
      }}
    >
      {/* A vaga de destino, já com colisão e compactação resolvidas: é onde o
          bloco VAI ficar, não onde o cursor está. */}
      {alvo && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl border-2 border-dashed border-accent/50 bg-accent-soft/60 transition-[transform,width,height] duration-150 ease-out"
          style={{
            transform: `translate(${alvo.celula.x * passo}px, ${alvo.celula.y * (LINHA_PX + VAO_PX)}px)`,
            width: alvo.w,
            height: alvo.h,
          }}
        />
      )}

      {blocos.map((b) => {
        const m = medidas(b.id);
        if (!m) return null;
        const ativo = gesto?.id === b.id;
        return (
          <div
            key={b.id}
            className={ativo ? "absolute z-30" : "absolute z-10"}
            style={{
              transform: `translate(${m.x}px, ${m.y}px)`,
              width: m.w,
              height: m.h,
              // Sem transição no bloco em gesto: qualquer suavização entre o
              // cursor e o bloco vira atraso perceptível. São os vizinhos que
              // deslizam.
              transition: ativo
                ? "none"
                : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), width 220ms cubic-bezier(0.2, 0.8, 0.2, 1), height 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
              willChange: emGesto ? "transform" : undefined,
            }}
          >
            <BlocoPainel
              bloco={b}
              temaId={temaId}
              onMudou={onMudou}
              celula={m.celula}
              gesto={ativo ? gesto!.gesto : null}
              comecar={comecar}
              porTeclado={porTeclado}
            />
          </div>
        );
      })}
    </div>
  );
}
