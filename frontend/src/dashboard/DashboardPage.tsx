import { ArrowLeft, BarChart3, Loader2, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SeletorDePaleta } from "@/components/SeletorDePaleta";
import { TrilhoDeSecoes } from "@/components/TrilhoDeSecoes";
import { Badge } from "@/components/ui/badge";
import {
  createDashboard,
  createWidget,
  dashboardData,
  deleteWidget,
  listDashboards,
  readDashboard,
  setDashboardGrid,
  setFilters,
} from "@/lib/api";
import { LINHA_PX, VAO_PX, type Dashboard, type DashboardFilters, type WidgetData } from "@/lib/types";
import { usePainel } from "@/theme/usePainel";
import { BarraDeFiltros } from "./BarraDeFiltros";
import { WidgetPainel } from "./WidgetPainel";

function idDaUrl(): string | null {
  return new URLSearchParams(location.search).get("painel");
}

function abrir(id: string | null) {
  const u = new URL(location.href);
  u.searchParams.delete("paineis");
  if (id) u.searchParams.set("painel", id);
  else {
    u.searchParams.delete("painel");
    u.searchParams.set("paineis", "");
  }
  history.pushState({}, "", u);
  dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * O painel: mostradores com filtros.
 *
 * É a terceira ferramenta, e não substitui nenhuma das outras. O chat é
 * efêmero, o tema acumula evidência congelada, e aqui tudo é vivo — cada widget
 * é uma consulta que roda de novo a cada filtro. Só gráfico e número: quem quer
 * guardar o porquê de um achado quer um tema, não um mostrador.
 */
export default function DashboardPage() {
  const [id, setId] = useState<string | null>(idDaUrl);
  const [lista, setLista] = useState<Dashboard[]>([]);
  const [painel, setPainel] = useState<Dashboard | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoVoltar = () => setId(idDaUrl());
    addEventListener("popstate", aoVoltar);
    return () => removeEventListener("popstate", aoVoltar);
  }, []);

  const carregar = useCallback(
    async (primeira = false) => {
      if (primeira) setCarregando(true);
      setErro(null);
      try {
        if (id) setPainel(await readDashboard(id));
        else setLista(await listDashboards());
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
    abrir((await createDashboard("Novo painel")).id);
  }

  return (
    <div className="flex min-h-full bg-canvas">
      <TrilhoDeSecoes
        aba="paineis"
        aberto
        onEscolher={(a) => {
          location.href = a === "paineis" ? "?paineis" : a === "temas" ? "?temas" : "/";
        }}
      />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 px-5 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3">
            <a
              href={id ? "?paineis" : "/"}
              onClick={(e) => {
                if (!id) return;
                e.preventDefault();
                abrir(null);
              }}
              className="flex items-center gap-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
              {id ? "Painéis" : "Voltar ao chat"}
            </a>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold text-ink">
                {painel && id ? painel.title : "Painéis"}
              </h1>
              {painel && id && (
                <p className="text-[11.5px] text-ink-subtle">
                  {painel.widgetCount} widget{painel.widgetCount === 1 ? "" : "s"} · números
                  recalculados a cada filtro
                </p>
              )}
            </div>
            <SeletorDePaleta />
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-5 py-6">
          {carregando && (
            <div className="flex justify-center py-16 text-ink-subtle">
              <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
            </div>
          )}
          {erro && (
            <p className="rounded-xl bg-critical-soft px-4 py-3 text-[13px] text-ink">{erro}</p>
          )}
          {!carregando && !erro && !id && <ListaDePaineis paineis={lista} onNovo={novo} />}
          {!carregando && !erro && id && painel && (
            <Detalhe painel={painel} onMudou={recarregar} />
          )}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function ListaDePaineis({ paineis, onNovo }: { paineis: Dashboard[]; onNovo: () => void }) {
  if (paineis.length === 0) {
    return (
      <div className="py-16 text-center">
        <BarChart3 aria-hidden className="mx-auto mb-3 h-7 w-7 text-ink-subtle" />
        <h2 className="text-[15px] font-semibold text-ink">Nenhum painel ainda</h2>
        <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-muted">
          Um painel mostra números que se recalculam quando você muda os filtros.
          Diferente de um tema, aqui nada fica congelado — e por isso não há texto
          nem citação, só gráfico e indicador.
        </p>
        <button
          onClick={onNovo}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Criar um painel
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-ink">
          {paineis.length} painel{paineis.length === 1 ? "" : "éis"}
        </h2>
        <button
          onClick={onNovo}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Novo
        </button>
      </div>
      <ul className="space-y-2">
        {paineis.map((p) => (
          <li key={p.id}>
            <a
              href={`?painel=${p.id}`}
              onClick={(e) => {
                e.preventDefault();
                abrir(p.id);
              }}
              className="flex items-baseline gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors duration-150 hover:border-accent/40"
            >
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
                {p.title}
              </span>
              <Badge tone="neutral">
                {p.widgetCount} widget{p.widgetCount === 1 ? "" : "s"}
              </Badge>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function Detalhe({ painel, onMudou }: { painel: Dashboard; onMudou: () => void }) {
  const widgets = painel.widgets ?? [];
  const [dados, setDados] = useState<Record<string, WidgetData>>({});
  const [rodando, setRodando] = useState(false);
  const [pedido, setPedido] = useState("");
  const [montando, setMontando] = useState(false);
  const [recusa, setRecusa] = useState("");
  const grade = usePainel(widgets, (l) => setDashboardGrid(painel.id, l), onMudou);

  // A assinatura dos filtros: recarrega quando o RECORTE muda, e não a cada
  // render. Sem isso, mexer no arranjo dispararia varredura no banco.
  const assinatura = JSON.stringify(painel.filters) + widgets.map((w) => w.id).join(",");
  const ultima = useRef("");
  useEffect(() => {
    if (!widgets.length || ultima.current === assinatura) return;
    ultima.current = assinatura;
    setRodando(true);
    dashboardData(painel.id)
      .then((r) => setDados(Object.fromEntries(r.data.map((d) => [d.id, d]))))
      .catch(() => setDados({}))
      .finally(() => setRodando(false));
  }, [assinatura, painel.id, widgets.length]);

  const ignoram = { periodo: 0, diagnostico: 0, uf: 0 } as Record<string, number>;
  for (const d of Object.values(dados)) for (const f of d.unapplied) ignoram[f] += 1;

  async function mudarFiltros(f: Partial<DashboardFilters>) {
    await setFilters(painel.id, { ...painel.filters, ...f });
    onMudou();
  }

  async function montar() {
    const q = pedido.trim();
    if (q.length < 3 || montando) return;
    setMontando(true);
    setRecusa("");
    try {
      const r = await createWidget(painel.id, q);
      if (r.refused) setRecusa(r.refused);
      else {
        setPedido("");
        ultima.current = "";
        onMudou();
      }
    } catch (e) {
      setRecusa(String(e));
    } finally {
      setMontando(false);
    }
  }

  return (
    <>
      <BarraDeFiltros
        filtros={painel.filters}
        onMudar={(f) => void mudarFiltros(f)}
        ignoram={ignoram}
        total={widgets.length}
        ocupado={rodando}
      />

      {/* A caixa de montar. Não é chat: não há conversa, não há memória — é um
          pedido que vira widget ou vira recusa com o motivo. */}
      <div className="mb-4 rounded-xl border border-line bg-surface px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-accent" />
          <input
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void montar()}
            placeholder="Descreva um gráfico ou indicador para acrescentar…"
            aria-label="Pedido de widget"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            onClick={() => void montar()}
            disabled={pedido.trim().length < 3 || montando}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
          >
            {montando ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : "Montar"}
          </button>
        </div>
        {recusa && (
          <p className="mt-2 rounded-lg bg-caution-soft px-3 py-2 text-[11.5px] leading-relaxed text-ink">
            {recusa}
          </p>
        )}
      </div>

      {widgets.length === 0 ? (
        <div className="py-16 text-center">
          <BarChart3 aria-hidden className="mx-auto mb-3 h-7 w-7 text-ink-subtle" />
          <p className="text-[13px] text-ink-muted">
            Painel vazio. Peça um gráfico acima — por exemplo,{" "}
            <span className="font-medium">&ldquo;óbitos por ano&rdquo;</span>.
          </p>
        </div>
      ) : (
        <div
          ref={grade.palco}
          className="relative rounded-lg"
          style={{
            height: grade.alturaDoPalco,
            backgroundImage: `linear-gradient(to right, ${grade.gesto ? "hsl(var(--accent) / 0.3)" : "hsl(var(--ink) / 0.09)"} 1px, transparent 1px),
               linear-gradient(to bottom, ${grade.gesto ? "hsl(var(--accent) / 0.3)" : "hsl(var(--ink) / 0.09)"} 1px, transparent 1px)`,
            backgroundSize: `${grade.larguraDaColuna() + VAO_PX}px ${LINHA_PX + VAO_PX}px`,
            backgroundPosition: "-1px -1px",
          }}
        >
          {grade.gesto && (
            <Fantasma grade={grade} />
          )}
          {widgets.map((w) => {
            const m = grade.medidas(w.id);
            if (!m) return null;
            const ativo = grade.gesto?.id === w.id;
            return (
              <div
                key={w.id}
                className={ativo ? "absolute z-30" : "absolute z-10"}
                style={{
                  transform: `translate(${m.x}px, ${m.y}px)`,
                  width: m.w,
                  height: m.h,
                  transition: ativo
                    ? "none"
                    : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), width 220ms cubic-bezier(0.2, 0.8, 0.2, 1), height 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                }}
              >
                <WidgetPainel
                  widget={w}
                  dados={dados[w.id]}
                  carregando={rodando}
                  onRemover={async () => {
                    await deleteWidget(painel.id, w.id);
                    ultima.current = "";
                    onMudou();
                  }}
                  celula={m.celula}
                  gesto={ativo ? grade.gesto!.gesto : null}
                  comecar={grade.comecar}
                  porTeclado={grade.porTeclado}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** O contorno da vaga de destino, igual ao do tema. */
function Fantasma({ grade }: { grade: ReturnType<typeof usePainel> }) {
  const alvo = grade.gesto ? grade.medidas(grade.gesto.id) : null;
  if (!alvo) return null;
  const passo = grade.larguraDaColuna() + VAO_PX;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-xl border-2 border-dashed border-accent/50 bg-accent-soft/60 transition-[transform,width,height] duration-150 ease-out"
      style={{
        transform: `translate(${alvo.celula.x * passo}px, ${alvo.celula.y * (LINHA_PX + VAO_PX)}px)`,
        width: alvo.w,
        height: alvo.h,
      }}
    />
  );
}
