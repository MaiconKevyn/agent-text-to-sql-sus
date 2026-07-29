import { ArrowLeft, BarChart3, Loader2, Plus, Sliders, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SeletorDePaleta } from "@/components/SeletorDePaleta";
import { TrilhoDeSecoes } from "@/components/TrilhoDeSecoes";
import { Badge } from "@/components/ui/badge";
import {
  askDashboardStream,
  createDashboard,
  createFilter,
  createWidget,
  dashboardData,
  deleteFilter,
  deleteWidget,
  listDashboards,
  panelCatalog,
  readDashboard,
  renameDashboard,
  selectFilter,
  setDashboardGrid,
  toggleWidgetFilter,
  updateFilter,
  updateWidgetChart,
  updateWidgetDisplay,
  updateWidgetManual,
} from "@/lib/api";
import {
  LINHA_PX,
  VAO_PX,
  type AnalysisPlan,
  type ChartSpec,
  type Dashboard,
  type PanelCatalog,
  type PlanItem,
  type WidgetData,
  type WidgetDisplay,
  type WidgetDraft,
} from "@/lib/types";
import { usePainel } from "@/theme/usePainel";
import { ControleDeFiltro } from "./ControleDeFiltro";
import { MenuDeCriacao } from "./MenuDeCriacao";
import { PainelDeTarefas } from "./PainelDeTarefas";
import { useFilaDePedidos } from "./useFilaDePedidos";
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
  // O catálogo é constante do servidor: uma busca por sessão, e o menu abre sem
  // esperar rede. Se ela falhar, o menu manual some e a caixa em linguagem
  // natural continua — melhor uma ferramenta a menos que um menu mentindo sobre
  // quais colunas existem.
  const [catalogo, setCatalogo] = useState<PanelCatalog | null>(null);
  useEffect(() => {
    panelCatalog()
      .then(setCatalogo)
      .catch(() => setCatalogo(null));
  }, []);

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
            <Detalhe painel={painel} catalogo={catalogo} onMudou={recarregar} />
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
          {/* "painel" + "éis" dá "paineléis": o plural troca a terminação, não a
              acrescenta. */}
          {paineis.length} {paineis.length === 1 ? "painel" : "painéis"}
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

function Detalhe({
  painel,
  catalogo,
  onMudou,
}: {
  painel: Dashboard;
  catalogo: PanelCatalog | null;
  onMudou: () => void;
}) {
  const widgets = painel.widgets ?? [];
  const [dados, setDados] = useState<Record<string, WidgetData>>({});
  const [rodando, setRodando] = useState(false);
  const [pedido, setPedido] = useState("");
  const [aviso, setAviso] = useState("");
  const [menu, setMenu] = useState(false);
  // O raciocínio do plano: o que a base permite ver sobre o assunto e o que
  // não permite. É a única parte da análise que não vira widget, e é a que
  // impede alguém de ler o painel como se ele respondesse mais do que responde.
  const [plano, setPlano] = useState<{ titulo: string; texto: string } | null>(null);
  const grade = usePainel(widgets, (l) => setDashboardGrid(painel.id, l), onMudou);

  /*
   * Quem precisa rodar de novo.
   *
   * Duas assinaturas, e não uma, porque as duas causas têm alcances diferentes:
   * mexer num FILTRO muda todo widget que o obedece, mas um widget novo — ou um
   * que ligou/desligou um filtro na lupa — só muda a si mesmo.
   *
   * Com uma assinatura só, uma análise de doze itens fazia o painel reexecutar
   * tudo doze vezes conforme os widgets chegavam: setenta e oito varreduras
   * sobre 144 milhões de linhas para mostrar as doze que alguém pediu, e o
   * DuckDB serializa as consultas num lock, então elas nem se sobrepõem.
   */
  // Só os filtros ATIVOS entram no recorte. Um filtro nasce com tudo marcado, o
  // que é o mesmo que não filtrar — e fazer o painel inteiro revarrer o banco
  // para criar um controle que ainda não recorta nada seria puro desperdício.
  const recorte = painel.filters
    .filter((f) => f.active)
    .map((f) => `${f.id}:${f.selection.join("|")}`)
    .join(",");
  const porWidget = widgets.map((w) => `${w.id}:${w.excluded.join("|")}`).join(",");
  const ultimoRecorte = useRef<string | null>(null);
  const ultimoPorWidget = useRef("");
  const comDados = useRef(new Set<string>());

  // Trocar de painel sem desmontar o componente deixaria os refs falando do
  // painel anterior. Os ids são únicos, então nada casaria errado — mas o
  // recorte guardado faria a primeira leitura parecer uma mudança de filtro.
  const painelAnterior = useRef(painel.id);
  if (painelAnterior.current !== painel.id) {
    painelAnterior.current = painel.id;
    ultimoRecorte.current = null;
    ultimoPorWidget.current = "";
    comDados.current = new Set();
  }

  useEffect(() => {
    if (!widgets.length) return;
    const trocouORecorte = ultimoRecorte.current !== null && ultimoRecorte.current !== recorte;
    const primeiraVez = ultimoRecorte.current === null;
    const antes = new Map(
      ultimoPorWidget.current.split(",").filter(Boolean).map((p) => {
        const i = p.indexOf(":");
        return [p.slice(0, i), p.slice(i + 1)] as [string, string];
      }),
    );

    const alvos =
      trocouORecorte || primeiraVez
        ? widgets.map((w) => w.id)
        : widgets
            .filter(
              (w) => !comDados.current.has(w.id) || antes.get(w.id) !== w.excluded.join("|"),
            )
            .map((w) => w.id);

    ultimoRecorte.current = recorte;
    ultimoPorWidget.current = porWidget;
    if (!alvos.length) return;

    setRodando(true);
    // `only` limita a varredura aos que mudaram. Sem ele, trocar uma cor num
    // widget custaria uma leitura do painel inteiro.
    dashboardData(painel.id, alvos.length === widgets.length ? undefined : alvos)
      .then((r) => {
        for (const d of r.data) comDados.current.add(d.id);
        setDados((atual) => ({
          ...atual,
          ...Object.fromEntries(r.data.map((d) => [d.id, d])),
        }));
      })
      .catch(() => undefined)
      .finally(() => setRodando(false));
  }, [recorte, porWidget, painel.id, widgets]);

  /**
   * Relê o painel. Não força nada a rodar de novo — quem decide é o efeito
   * acima, comparando o que mudou: um widget novo entra sem dados e é buscado
   * sozinho; os que já estão na tela ficam como estão.
   */
  const recarregar = useCallback(() => onMudou(), [onMudou]);

  // A fila precisa de si mesma dentro do executor — é ela que enfileira os
  // itens do plano —, e o executor é argumento dela. O ref quebra o círculo.
  const filaRef = useRef<ReturnType<typeof useFilaDePedidos> | null>(null);

  /**
   * Recebe um plano e o transforma numa fila de pedidos.
   *
   * O painel também ganha o título do plano, mas só enquanto ele for "Novo
   * painel": renomear por cima de um nome escolhido a mão seria apagar uma
   * decisão de quem usa para pôr uma do modelo no lugar.
   */
  const aplicarPlano = useCallback(
    (p: AnalysisPlan, itens: PlanItem[]) => {
      const resumo = p.title.length > 40 ? `${p.title.slice(0, 39)}…` : p.title;
      const aviso = filaRef.current?.enfileirarLote(
        itens.map((i) => i.request),
        resumo,
      );
      setAviso(aviso ?? "");
      if (p.reasoning) setPlano({ titulo: p.title, texto: p.reasoning });
      if (p.title && painel.title === "Novo painel") {
        void renameDashboard(painel.id, p.title).then(onMudou);
      }
    },
    [painel.id, painel.title, onMudou],
  );

  // A caixa deixou de bloquear: cada envio vira uma tarefa na fila do canto.
  // Montar um widget leva de dez a quarenta segundos, e quem já sabe o que quer
  // não deveria digitar-esperar-digitar-esperar.
  const fila = useFilaDePedidos(
    useCallback(
      async (texto: string, aoPassar) => {
        const r = await askDashboardStream(painel.id, texto, aoPassar);
        // Uma análise não cria nada por si: ela devolve o plano, e cada item
        // dele vira uma tarefa irmã. Assim um item que a base não sustenta
        // recusa sozinho, com o motivo, sem derrubar os outros onze.
        if (r.kind === "analise") {
          const itens = r.items ?? [];
          if (r.refused || !itens.length) {
            return { tipo: "analise" as const, recusa: r.refused || "O plano voltou vazio." };
          }
          aplicarPlano(
            { title: r.title ?? texto, reasoning: r.reasoning ?? "", items: itens, refused: "" },
            itens,
          );
          return { tipo: "analise" as const, recusa: "" };
        }
        return { tipo: r.kind, recusa: r.refused };
      },
      [painel.id, aplicarPlano],
    ),
    recarregar,
  );
  filaRef.current = fila;

  function enviar(forcar?: "widget" | "filtro") {
    const q = pedido.trim();
    if (q.length < 3) return;
    // Forçar o tipo é um caminho à parte: ele existe para quando a
    // classificação erra, e aí a pessoa está olhando o resultado — não faria
    // sentido enfileirar e esperar.
    if (forcar) {
      setAviso("");
      const chamada = forcar === "filtro" ? createFilter : createWidget;
      void chamada(painel.id, q).then((r) => {
        if (r.refused) setAviso(r.refused);
        else {
          setPedido("");
          recarregar();
        }
      });
      return;
    }
    const recusa = fila.enfileirar(q);
    setAviso(recusa);
    if (!recusa) setPedido("");
  }

  const ativos = painel.filters.filter((f) => f.active).length;

  return (
    <>
      {/* A caixa: um pedido vira widget ou filtro conforme a intenção. Os dois
          botões ao lado existem para quando a classificação erra — sem eles, um
          pedido mal classificado seria um beco. */}
      <div className="mb-3 rounded-xl border border-line bg-surface px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-accent" />
          <input
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar()}
            placeholder="Peça um gráfico ou um filtro — &ldquo;óbitos por ano&rdquo;, &ldquo;filtro por sexo&rdquo;…"
            aria-label="Pedido ao painel"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            onClick={() => enviar()}
            disabled={pedido.trim().length < 3}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
          >
            Enviar
          </button>
          {/* O menu manual não substitui a caixa: ele resolve o que ela não
              resolve. Quem sabe exatamente o que quer escolhe em quatro menus
              mais rápido do que descreve em português — e sem torcer para a
              classificação acertar. */}
          {catalogo && (
            <button
              onClick={() => setMenu(true)}
              title="Montar escolhendo medida, eixo, forma e cores"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
            >
              <Sliders aria-hidden className="h-3.5 w-3.5" />
              Montar
            </button>
          )}
        </div>
        {pedido.trim().length >= 3 && (
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-subtle">
            ou force:
            <button onClick={() => enviar("widget")} className="rounded border border-line px-1.5 py-px hover:border-accent/40 hover:text-accent">
              como gráfico
            </button>
            <button onClick={() => enviar("filtro")} className="rounded border border-line px-1.5 py-px hover:border-accent/40 hover:text-accent">
              como filtro
            </button>
          </div>
        )}
        {aviso && (
          <p className="mt-2 rounded-lg bg-caution-soft px-3 py-2 text-[11.5px] leading-relaxed text-ink">
            {aviso}
          </p>
        )}
        {fila.emCurso > 0 && (
          <p className="mt-1.5 text-[11px] text-ink-subtle">
            {fila.emCurso} pedido(s) em andamento — pode continuar mexendo no painel.
          </p>
        )}
      </div>

      {/* O raciocínio do plano. É a única parte de uma análise que não vira
          widget — e a que diz o que a base NÃO mostra sobre o assunto. Sem
          isto, um painel de doze gráficos parece responder tudo. */}
      {plano && (
        <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft/40 px-3.5 py-2.5">
          <div className="flex items-baseline gap-2">
            <h2 className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">{plano.titulo}</h2>
            <button
              onClick={() => setPlano(null)}
              aria-label="Fechar o resumo do plano"
              className="shrink-0 rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-ink"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{plano.texto}</p>
        </div>
      )}

      {/* Os filtros. Valem para TODOS os widgets ao mesmo tempo. */}
      <section aria-label="Filtros" className="mb-4">
        <div className="mb-1.5 flex items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            Filtros
          </h2>
          <span className="text-[11px] text-ink-subtle">
            {painel.filters.length === 0
              ? "nenhum — peça um acima"
              : `${ativos} de ${painel.filters.length} recortando · valem para todos os gráficos`}
          </span>
        </div>
        {painel.filters.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {painel.filters.map((f) => (
              <ControleDeFiltro
                key={f.id}
                filtro={f}
                catalogo={catalogo}
                onSelecionar={async (sel) => {
                  await selectFilter(painel.id, f.id, sel);
                  recarregar();
                }}
                onRemover={async () => {
                  await deleteFilter(painel.id, f.id);
                  recarregar();
                }}
                onEditar={async (patch) => {
                  const r = await updateFilter(painel.id, f.id, patch);
                  // Trocar a coluna refaz o domínio e zera a seleção, então o
                  // recorte muda: os widgets precisam rodar de novo.
                  if (!r.refused) recarregar();
                  return r.refused;
                }}
              />
            ))}
          </div>
        )}
      </section>

      {widgets.length === 0 ? (
        <div className="py-16 text-center">
          <BarChart3 aria-hidden className="mx-auto mb-3 h-7 w-7 text-ink-subtle" />
          <p className="text-[13px] text-ink-muted">
            Painel vazio. Peça acima — por exemplo,{" "}
            <span className="font-medium">&ldquo;óbitos por ano&rdquo;</span> ou{" "}
            <span className="font-medium">&ldquo;filtro por sexo&rdquo;</span>.
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
          {grade.gesto && <Fantasma grade={grade} />}
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
                    recarregar();
                  }}
                  onRecriar={async () => {
                    // A pergunta original ficou guardada justamente para isto.
                    await createWidget(painel.id, w.question);
                    await deleteWidget(painel.id, w.id);
                    recarregar();
                  }}
                  filtros={painel.filters}
                  onAlternarFiltro={async (fid) => {
                    await toggleWidgetFilter(painel.id, w.id, fid);
                    recarregar();
                  }}
                  celula={m.celula}
                  gesto={ativo ? grade.gesto!.gesto : null}
                  comecar={grade.comecar}
                  porTeclado={grade.porTeclado}
                  catalogo={catalogo}
                  onRefazer={async (draft: WidgetDraft) => {
                    const r = await updateWidgetManual(painel.id, w.id, draft);
                    // O SQL mudou: este widget precisa rodar de novo. Os
                    // outros não — `comDados` guarda quem já tem resultado, e
                    // o id sumido dele é o que dispara só esta leitura.
                    if (!r.refused) {
                      comDados.current.delete(w.id);
                      onMudou();
                    }
                    return r.refused;
                  }}
                  onAparencia={async (patch: Partial<ChartSpec>) => {
                    const r = await updateWidgetChart(painel.id, w.id, patch);
                    // Só a aparência mudou: nenhuma consulta roda de novo, e
                    // por isso `onMudou` basta — recarregar tudo faria o painel
                    // inteiro varrer o banco para trocar uma cor.
                    if (!r.refused) onMudou();
                    return r.refused;
                  }}
                  onExibicao={async (d: WidgetDisplay) => {
                    const r = await updateWidgetDisplay(painel.id, w.id, d);
                    if (!r.refused) onMudou();
                    return r.refused;
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {menu && catalogo && (
        <MenuDeCriacao
          painelId={painel.id}
          catalogo={catalogo}
          onCriado={() => {
            setMenu(false);
            recarregar();
          }}
          onPlano={(p, itens) => {
            setMenu(false);
            aplicarPlano(p, itens);
          }}
          onFechar={() => setMenu(false)}
        />
      )}

      <PainelDeTarefas
        tarefas={fila.tarefas}
        onDispensar={fila.dispensar}
        onLimpar={fila.limparConcluidas}
      />
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
