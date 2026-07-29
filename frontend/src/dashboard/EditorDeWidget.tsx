import { Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  ChartSpec,
  DashboardWidget,
  PanelCatalog,
  QueryResult,
  WidgetDisplay,
  WidgetDraft,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { CamposDoGrafico, ResumoDoGrafico } from "./CamposDoGrafico";
import { Alternador, Campo, Flutuante, Recusa } from "./controles";

type Aba = "dados" | "aparencia" | "exibicao";

interface Props {
  widget: DashboardWidget;
  /** O resultado atual: é dele que saem as colunas oferecidas nos eixos. */
  resultado: QueryResult | null;
  catalogo: PanelCatalog | null;
  /** Cada uma devolve a recusa, ou string vazia se deu certo. */
  onRefazer: (draft: WidgetDraft) => Promise<string>;
  onAparencia: (patch: Partial<ChartSpec>) => Promise<string>;
  onExibicao: (d: WidgetDisplay) => Promise<string>;
}

/**
 * A edição de um widget que já existe.
 *
 * São três coisas diferentes com custos diferentes, e por isso três abas:
 *
 *   DADOS refaz a consulta — troca a medida, o eixo, a série. Custa uma
 *   varredura no banco e só existe para quem nasceu do menu, porque só esses
 *   guardam as escolhas. Reconstruí-las a partir do SQL de um widget escrito por
 *   modelo seria adivinhação, e adivinhação errada aqui troca em silêncio o que
 *   o gráfico mede.
 *
 *   APARÊNCIA não toca no SQL: reetiqueta qual coluna do resultado vai para
 *   qual eixo. Nada roda de novo, e por isso vale para TODO gráfico, inclusive
 *   os que um modelo escreveu — que são a maioria do painel.
 *
 *   EXIBIÇÃO é do indicador: compacto e tamanho do número. Também não roda nada.
 */
export function EditorDeWidget({
  widget,
  resultado,
  catalogo,
  onRefazer,
  onAparencia,
  onExibicao,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    // O painel vive no `body` por causa do portal, então "clicou fora" precisa
    // olhar as DUAS caixas: a do botão e a do painel.
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !painel.current?.contains(alvo)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="relative">
      <button
        ref={botao}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label="Editar o widget"
        title="Editar: dados, aparência, exibição"
        className="rounded p-1 text-ink-subtle transition-colors duration-150 hover:text-ink"
      >
        <Pencil aria-hidden className="h-3.5 w-3.5" />
      </button>

      {aberto && (
        <Flutuante ancora={botao} largura={352}>
          <div ref={painel}>
            <Formulario
              widget={widget}
              resultado={resultado}
              catalogo={catalogo}
              onRefazer={onRefazer}
              onAparencia={onAparencia}
              onExibicao={onExibicao}
              onFechar={() => setAberto(false)}
            />
          </div>
        </Flutuante>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

const CAIXA =
  "w-full rounded-md border border-line bg-canvas px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent";

function Formulario({
  widget,
  resultado,
  catalogo,
  onRefazer,
  onAparencia,
  onExibicao,
  onFechar,
}: Props & { onFechar: () => void }) {
  const grafico = widget.format === "grafico" && widget.chart;
  const podeRefazer = Boolean(widget.build && catalogo);
  const [aba, setAba] = useState<Aba>(
    podeRefazer ? "dados" : grafico ? "aparencia" : "exibicao",
  );

  const abas: { id: Aba; rotulo: string; existe: boolean }[] = [
    { id: "dados", rotulo: "Dados", existe: podeRefazer },
    { id: "aparencia", rotulo: "Aparência", existe: Boolean(grafico) },
    { id: "exibicao", rotulo: "Exibição", existe: widget.format === "indicador" },
  ];
  const visiveis = abas.filter((a) => a.existe);

  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl">
      <header className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {visiveis.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            aria-current={aba === a.id}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-150",
              aba === a.id ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink",
            )}
          >
            {a.rotulo}
          </button>
        ))}
        <button
          onClick={onFechar}
          aria-label="Fechar"
          className="ml-auto rounded p-0.5 text-ink-subtle hover:text-ink"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      </header>

      {aba === "dados" && catalogo && widget.build && (
        <AbaDados
          catalogo={catalogo}
          inicial={widget.build}
          onRefazer={onRefazer}
          onFechar={onFechar}
        />
      )}
      {aba === "aparencia" && grafico && (
        <AbaAparencia
          spec={widget.chart!}
          resultado={resultado}
          formas={catalogo?.forms ?? []}
          onSalvar={onAparencia}
          onFechar={onFechar}
        />
      )}
      {aba === "exibicao" && (
        <AbaExibicao inicial={widget.display} onSalvar={onExibicao} onFechar={onFechar} />
      )}

      {!podeRefazer && aba === "aparencia" && (
        <p className="border-t border-line px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-subtle">
          Este gráfico foi escrito a partir de uma pergunta, não montado no menu — então não
          há escolhas para reabrir. Para mudar o que ele mede, use &ldquo;recriar&rdquo; no
          detalhe e reescreva o pedido.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AbaDados({
  catalogo,
  inicial,
  onRefazer,
  onFechar,
}: {
  catalogo: PanelCatalog;
  inicial: WidgetDraft;
  onRefazer: (d: WidgetDraft) => Promise<string>;
  onFechar: () => void;
}) {
  const [rascunho, setRascunho] = useState<WidgetDraft>(inicial);
  const [recusa, setRecusa] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    const erro = await onRefazer(rascunho);
    setSalvando(false);
    if (erro) setRecusa(erro);
    else onFechar();
  }

  return (
    <div className="space-y-2.5 p-2.5">
      <CamposDoGrafico catalogo={catalogo} valor={rascunho} onMudar={setRascunho} />
      <Recusa texto={recusa} />
      <div className="flex items-center gap-2 border-t border-line pt-2">
        <ResumoDoGrafico catalogo={catalogo} valor={rascunho} />
        <button
          onClick={salvar}
          disabled={salvando}
          className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
        >
          {salvando ? "Refazendo…" : "Refazer"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AbaAparencia({
  spec,
  resultado,
  formas,
  onSalvar,
  onFechar,
}: {
  spec: ChartSpec;
  resultado: QueryResult | null;
  formas: PanelCatalog["forms"];
  onSalvar: (p: Partial<ChartSpec>) => Promise<string>;
  onFechar: () => void;
}) {
  const colunas = resultado?.columns ?? [];
  const [forma, setForma] = useState(spec.kind);
  const [x, setX] = useState(spec.x);
  const [y, setY] = useState(spec.y);
  const [serie, setSerie] = useState(spec.series ?? "");
  const [cores, setCores] = useState<string[]>(spec.colors ?? []);
  const [rotulos, setRotulos] = useState(spec.showLabels ?? false);
  const [legenda, setLegenda] = useState(spec.showLegend ?? true);
  const [suave, setSuave] = useState(spec.smooth ?? true);
  const [area, setArea] = useState(spec.area ?? false);
  const [empilhar, setEmpilhar] = useState(spec.stack ?? false);
  const [recusa, setRecusa] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Quantas cores mostrar: uma por série de verdade. Sem coluna de série é uma
  // só — exceto na pizza, em que cada fatia é uma cor.
  const quantasCores = (() => {
    if (!resultado) return 1;
    const is = serie ? colunas.indexOf(serie) : -1;
    if (is >= 0) return Math.min(12, new Set(resultado.rows.map((r) => String(r[is]))).size);
    if (forma === "pizza") return Math.min(12, resultado.rows.length);
    return 1;
  })();

  const formaAtual = formas.find((f) => f.id === forma);

  async function salvar() {
    setSalvando(true);
    const erro = await onSalvar({
      kind: forma,
      x,
      y,
      series: serie,
      appearance: {
        colors: cores.some(Boolean) ? cores.slice(0, quantasCores) : null,
        showLabels: rotulos,
        showLegend: legenda,
        smooth: suave,
        area,
        stack: empilhar,
      },
    } as Partial<ChartSpec>);
    setSalvando(false);
    if (erro) setRecusa(erro);
    else onFechar();
  }

  return (
    <div className="space-y-2.5 p-2.5">
      <div className="flex flex-wrap gap-1">
        {formas.map((f) => {
          const bloqueada = f.needsSeries && !serie;
          return (
            <button
              key={f.id}
              disabled={bloqueada}
              onClick={() => setForma(f.id)}
              aria-pressed={forma === f.id}
              title={bloqueada ? `${f.label} exige uma série` : f.label}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150",
                forma === f.id
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-muted hover:text-ink",
                bloqueada && "cursor-not-allowed opacity-35",
              )}
            >
              {f.label.replace(/ \(.*\)/, "")}
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-1.5">
        <label className="min-w-0 flex-1">
          {/* Os rótulos dizem o PAPEL de cada eixo, não só a letra: X é a
              categoria e Y é o valor. Sem isso, "inverter" parece deitar o
              gráfico — e o que faz é pôr texto no eixo do número, que desenha
              um gráfico em branco. */}
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
            X · categoria
          </span>
          <select value={x} onChange={(e) => setX(e.target.value)} className={CAIXA}>
            {colunas.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setX(y);
            setY(x);
          }}
          title="Trocar as duas colunas de lugar. Para deitar as barras, use a forma 'Barras horizontais'."
          aria-label="Trocar as colunas dos eixos X e Y"
          className="mb-px shrink-0 rounded-md border border-line p-1 text-ink-subtle transition-colors duration-150 hover:border-accent/40 hover:text-accent"
        >
          <RotateCcw aria-hidden className="h-3 w-3" />
        </button>
        <label className="min-w-0 flex-1">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
            Y · valor
          </span>
          <select value={y} onChange={(e) => setY(e.target.value)} className={CAIXA}>
            {colunas.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
          Série
        </span>
        <select value={serie} onChange={(e) => setSerie(e.target.value)} className={CAIXA}>
          <option value="">— nenhuma —</option>
          {colunas
            .filter((c) => c !== x && c !== y)
            .map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-1">
        {[
          { rot: "valores", v: rotulos, set: setRotulos, quando: true },
          { rot: "legenda", v: legenda, set: setLegenda, quando: !!serie || forma === "pizza" },
          { rot: "suavizar", v: suave, set: setSuave, quando: forma === "linha" },
          { rot: "área", v: area, set: setArea, quando: forma === "linha" },
          { rot: "empilhar", v: empilhar, set: setEmpilhar, quando: forma === "barra" && !!serie },
        ]
          .filter((o) => o.quando)
          .map((o) => (
            <Alternador key={o.rot} ligado={o.v} onMudar={o.set}>
              {o.rot}
            </Alternador>
          ))}
      </div>

      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-subtle">
          Cores
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {Array.from({ length: quantasCores }).map((_, i) => (
            <input
              key={i}
              type="color"
              value={cores[i] ?? "#4a7fd4"}
              onChange={(e) =>
                setCores((c) => {
                  const n = [...c];
                  // As anteriores não podem ficar vazias: uma lista com buraco
                  // pintaria a série 2 com a cor da 1 no lugar da paleta.
                  for (let k = 0; k < i; k++) n[k] ??= "#4a7fd4";
                  n[i] = e.target.value;
                  return n;
                })
              }
              aria-label={`Cor da série ${i + 1}`}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          ))}
          {cores.some(Boolean) && (
            <button
              onClick={() => setCores([])}
              title="Voltar para a paleta do tema, que é validada para daltonismo e contraste"
              className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-subtle transition-colors duration-150 hover:text-ink"
            >
              usar a paleta
            </button>
          )}
        </div>
      </div>

      <Recusa texto={recusa} />

      <button
        onClick={salvar}
        disabled={salvando || (formaAtual?.needsSeries && !serie)}
        className="w-full rounded-md bg-accent px-2 py-1.5 text-[11.5px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
      >
        {salvando ? "Salvando…" : "Aplicar"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/** O tamanho do número, em múltiplos da base de 30px. */
const TAMANHOS: { escala: number; rotulo: string }[] = [
  { escala: 0.7, rotulo: "P" },
  { escala: 1.0, rotulo: "M" },
  { escala: 1.4, rotulo: "G" },
  { escala: 1.9, rotulo: "GG" },
];

function AbaExibicao({
  inicial,
  onSalvar,
  onFechar,
}: {
  inicial: WidgetDisplay;
  onSalvar: (d: WidgetDisplay) => Promise<string>;
  onFechar: () => void;
}) {
  const [compacto, setCompacto] = useState(inicial?.compact ?? false);
  const [escala, setEscala] = useState(inicial?.scale ?? 1);
  const [recusa, setRecusa] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    const erro = await onSalvar({ compact: compacto, scale: escala });
    setSalvando(false);
    if (erro) setRecusa(erro);
    else onFechar();
  }

  return (
    <div className="space-y-2.5 p-2.5">
      <Campo rotulo="Espaço">
        <Alternador ligado={compacto} onMudar={setCompacto}>
          compacto — só título e número
        </Alternador>
      </Campo>

      <Campo rotulo={`Tamanho do número — ${Math.round(escala * 30)}px`}>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            {TAMANHOS.map((t) => (
              <button
                key={t.rotulo}
                onClick={() => setEscala(t.escala)}
                aria-pressed={Math.abs(escala - t.escala) < 0.05}
                className={cn(
                  "w-8 rounded border py-0.5 text-[10.5px] transition-colors duration-150",
                  Math.abs(escala - t.escala) < 0.05
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-ink-muted hover:text-ink",
                )}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          {/* O deslizante existe para o meio-termo entre os quatro presets: a
              largura útil de um indicador muda com o tamanho da coluna, e o
              número certo raramente é um dos quatro. */}
          <input
            type="range"
            min={0.6}
            max={2.2}
            step={0.05}
            value={escala}
            onChange={(e) => setEscala(Number(e.target.value))}
            aria-label="Tamanho do número"
            className="h-1 min-w-0 flex-1 cursor-pointer accent-[hsl(var(--accent))]"
          />
        </div>
      </Campo>

      <div className="rounded-lg border border-line bg-canvas px-2.5 py-2">
        <span className="block text-[10px] uppercase tracking-wide text-ink-subtle">
          Prévia
        </span>
        <span
          className="mt-1 block font-semibold leading-none tracking-tight text-ink [font-variant-numeric:tabular-nums]"
          style={{ fontSize: `${escala * 30}px` }}
        >
          144.386.772
        </span>
        {!compacto && (
          <span className="mt-1 block text-[11px] text-ink-subtle">rótulo da coluna</span>
        )}
      </div>

      <Recusa texto={recusa} />

      <button
        onClick={salvar}
        disabled={salvando}
        className="w-full rounded-md bg-accent px-2 py-1.5 text-[11.5px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
      >
        {salvando ? "Salvando…" : "Aplicar"}
      </button>
    </div>
  );
}

