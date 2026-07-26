import { Check, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePaleta } from "@/hooks/usePaleta";
import { useTheme } from "@/hooks/useTheme";
import { PALETAS } from "@/lib/paletas";
import { cn } from "@/lib/utils";

/**
 * Escolha de paleta e de modo, num lugar só.
 *
 * Juntos porque são a mesma decisão para quem usa — "como isto vai ficar" — e
 * porque algumas paletas fixam o modo. Um botão de claro/escuro separado
 * mentiria ao ficar disponível com o Darcula selecionado.
 *
 * A amostra mostra as cores REAIS da paleta: fundo, superfície e os três
 * primeiros passos de série. Um nome sozinho não diz nada, e um quadradinho de
 * cor de acento diz menos ainda — o que muda a tela é o conjunto.
 */
interface Props {
  compacto?: boolean;
  /**
   * Quando presente, o seletor governa a paleta DESTE TEMA, e não a do site.
   * `atual` vazio significa "herda a do site" — e essa é uma opção da lista,
   * não um estado escondido: sem ela não haveria como voltar atrás.
   */
  doTema?: { atual: string; aoEscolher: (paleta: string) => void | Promise<void> };
}

export function SeletorDePaleta({ compacto = false, doTema }: Props) {
  const { paleta: doSite, escolher: escolherSite } = usePaleta();
  const paleta = doTema ? doTema.atual : doSite;
  const escolher = doTema ? doTema.aoEscolher : escolherSite;
  const { theme, toggle } = useTheme();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const atual = PALETAS.find((p) => p.id === paleta);
  const modoTravado = Boolean(atual?.fixo) && !doTema;

  return (
    <div ref={caixa} className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label="Escolher a aparência"
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <Palette aria-hidden className="h-3.5 w-3.5" />
        {!compacto && (atual?.nome ?? "Aparência")}
      </button>

      {aberto && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          {doTema && (
            <p className="px-2 pb-1 pt-0.5 text-[10.5px] uppercase tracking-wide text-ink-subtle">
              Aparência deste tema
            </p>
          )}
          <ul className="space-y-0.5">
            {doTema && (
              <li>
                <button
                  onClick={() => {
                    void escolher("");
                    setAberto(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150",
                    !paleta ? "bg-accent-soft" : "hover:bg-raised",
                  )}
                >
                  <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-line text-[10px] text-ink-subtle">
                    site
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] font-medium text-ink">
                    Herdar do site
                  </span>
                  {!paleta && <Check aria-hidden className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              </li>
            )}
            {PALETAS.map((p) => {
              const modo = p.fixo ?? theme;
              const t = (modo === "dark" ? p.escuro : p.claro) ?? {};
              const cor = (nome: string, alt: string) => `hsl(${t[nome] ?? alt})`;
              const series = p.serie[modo === "dark" ? "escuro" : "claro"];
              const escolhida = p.id === paleta;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      escolher(p.id);
                      setAberto(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150",
                      escolhida ? "bg-accent-soft" : "hover:bg-raised",
                    )}
                  >
                    {/* A amostra: fundo, superfície e as três primeiras séries. */}
                    <span
                      className="flex h-8 w-12 shrink-0 items-end gap-[2px] rounded-md border border-line p-1"
                      style={{
                        background: cor(
                          "--canvas",
                          modo === "dark" ? "216 33% 8%" : "210 25% 98%",
                        ),
                      }}
                      aria-hidden
                    >
                      {series.slice(0, 3).map((c) => (
                        <span
                          key={c}
                          className="h-full flex-1 rounded-[2px]"
                          style={{ background: c }}
                        />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-ink">{p.nome}</span>
                      <span className="block truncate text-[11px] leading-snug text-ink-muted">
                        {p.descricao}
                      </span>
                    </span>
                    {escolhida && <Check aria-hidden className="h-4 w-4 shrink-0 text-accent" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-1.5 border-t border-line pt-1.5">
            <button
              onClick={toggle}
              disabled={modoTravado}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-muted transition-colors duration-150 hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {theme === "dark" ? (
                <Sun aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Moon aria-hidden className="h-3.5 w-3.5" />
              )}
              {theme === "dark" ? "Tema claro" : "Tema escuro"}
              {modoTravado && (
                <span className="ml-auto text-[10.5px] text-ink-subtle">
                  {atual?.nome} é só escuro
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
