import { Info, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PanelCatalog, PanelFilter } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SELECT, porGrupo } from "./controles";

const nf = new Intl.NumberFormat("pt-BR");

/**
 * Trocar a coluna, o controle ou o nome de um filtro que já existe.
 *
 * O id sobrevive à troca, e é isso que importa: as exclusões da lupa vivem nos
 * widgets e apontam para ele. Recriar com id novo faria todo widget que
 * dispensava aquele filtro voltar a obedecê-lo em silêncio.
 *
 * A SELEÇÃO não sobrevive a uma troca de coluna, e não tem como — os valores de
 * UF não significam nada em SEXO. O filtro volta a nascer sem recortar, que já
 * é o padrão, e a tela avisa antes.
 */
function Edicao({
  filtro,
  catalogo,
  onEditar,
  onFechar,
}: {
  filtro: PanelFilter;
  catalogo: PanelCatalog | null;
  onEditar: (patch: { field?: string; kind?: string; label?: string }) => Promise<string>;
  onFechar: () => void;
}) {
  const [campo, setCampo] = useState(filtro.field);
  const [tipo, setTipo] = useState(filtro.kind);
  const [rotulo, setRotulo] = useState(filtro.label);
  const [recusa, setRecusa] = useState("");
  const [salvando, setSalvando] = useState(false);

  const filtraveis = catalogo?.fields.filter((f) => f.filters.length > 0) ?? [];
  const c = filtraveis.find((x) => x.id === campo);
  const trocaColuna = campo !== filtro.field || tipo !== filtro.kind;

  useEffect(() => {
    if (c && !c.filters.includes(tipo)) setTipo(c.filters[0]);
  }, [c, tipo]);

  /**
   * Trocar a coluna leva o nome junto — mas só se o nome não foi escolhido a
   * mão. Sem isto, trocar "UF de residência" por "Faixa etária" deixa na tela
   * um filtro chamado "Estado" mostrando faixas de idade, e quem olhar depois
   * vai ler o rótulo, não as opções.
   *
   * O teste é comparar com o padrão da coluna ANTERIOR: se bate, o nome era
   * herdado e pode ser trocado; se não bate, alguém digitou aquilo e a escolha
   * fica.
   */
  function trocarColuna(novo: string) {
    const antigo = filtraveis.find((x) => x.id === campo);
    setCampo(novo);
    if (!antigo || rotulo.trim() === antigo.label) {
      setRotulo(filtraveis.find((x) => x.id === novo)?.label ?? rotulo);
    }
  }

  async function salvar() {
    setSalvando(true);
    const erro = await onEditar({ field: campo, kind: tipo, label: rotulo });
    setSalvando(false);
    if (erro) setRecusa(erro);
    else onFechar();
  }

  return (
    <div className="mb-2 space-y-2 rounded-lg border border-line bg-surface p-2">
      <label className="block">
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
          Nome na tela
        </span>
        <input value={rotulo} onChange={(e) => setRotulo(e.target.value)} className={SELECT} />
      </label>

      {catalogo && (
        <>
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-subtle">
              Coluna
            </span>
            <select
              value={campo}
              onChange={(e) => trocarColuna(e.target.value)}
              className={SELECT}
            >
              {/* Um filtro declarado por modelo não tem campo do catálogo. A
                  opção vazia diz isso em vez de fingir que a coluna é uma das
                  da lista — adivinhar a partir do fragmento erraria calado. */}
              {!filtro.field && <option value="">— declarado por linguagem natural —</option>}
              {porGrupo(filtraveis).map(([grupo, campos]) => (
                <optgroup key={grupo} label={grupo}>
                  {campos.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-1">
            {catalogo.filterKinds.map((k) => {
              const cabe = c?.filters.includes(k.id) ?? k.id === filtro.kind;
              return (
                <button
                  key={k.id}
                  disabled={!cabe}
                  onClick={() => setTipo(k.id)}
                  aria-pressed={tipo === k.id}
                  title={cabe ? k.label : `${c?.label ?? "esta coluna"} não aceita este controle`}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150",
                    tipo === k.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-muted hover:text-ink",
                    !cabe && "cursor-not-allowed opacity-35",
                  )}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {trocaColuna && (
        <p className="rounded bg-caution-soft px-2 py-1 text-[10.5px] leading-relaxed text-ink">
          Trocar a coluna refaz o filtro: as opções vêm do banco de novo e a seleção atual
          se perde. Os gráficos que dispensam este filtro continuam dispensando.
        </p>
      )}
      {recusa && (
        <p className="rounded bg-caution-soft px-2 py-1 text-[10.5px] leading-relaxed text-ink">
          {recusa}
        </p>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={salvar}
          disabled={salvando}
          className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
        >
          {salvando ? "Salvando…" : "Aplicar"}
        </button>
        <button
          onClick={onFechar}
          className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

interface Props {
  filtro: PanelFilter;
  catalogo: PanelCatalog | null;
  onSelecionar: (selecao: (string | number)[]) => void;
  onRemover: () => void;
  /** Devolve a recusa, ou string vazia. */
  onEditar: (patch: { field?: string; kind?: string; label?: string }) => Promise<string>;
}

/**
 * Um filtro do painel, desenhado conforme o tipo que foi declarado.
 *
 * As opções vêm do BANCO, com a contagem de cada uma. Isso não é enfeite: numa
 * base do SUS, `SEXO` tem 1 e 3, e um controle com "Masculino/Feminino" escrito
 * à mão esconderia que o 2 não existe. A contagem ao lado também diz quando uma
 * opção é resíduo — 4 mil linhas contra 85 milhões é ruído, não categoria.
 *
 * Tudo marcado é o mesmo que nada marcado: o filtro fica inativo e não entra na
 * consulta. É o que evita o truque de vincular um curinga, que na versão
 * anterior deixava widgets permanentemente vazios sem nunca dar erro.
 */
export function ControleDeFiltro({
  filtro,
  catalogo,
  onSelecionar,
  onRemover,
  onEditar,
}: Props) {
  const [editando, setEditando] = useState(false);
  // Só a faixa numérica precisa de estado local: o slider tem de se mover a
  // cada quadro do arrasto e só gravar quando o dedo levanta. O campo de data
  // grava direto — quem escolhe uma data já escolheu.
  const [faixa, setFaixa] = useState<[number, number]>([
    Number(filtro.selection[0] ?? filtro.min ?? 0),
    Number(filtro.selection[1] ?? filtro.max ?? 0),
  ]);
  useEffect(() => {
    if (filtro.kind !== "faixa") return;
    setFaixa([
      Number(filtro.selection[0] ?? filtro.min ?? 0),
      Number(filtro.selection[1] ?? filtro.max ?? 0),
    ]);
  }, [filtro.selection, filtro.kind, filtro.min, filtro.max]);

  const marcado = (v: string | number) => filtro.selection.includes(v);

  function alternar(v: string | number) {
    if (filtro.kind === "escolha") return onSelecionar([v]);
    const nova = marcado(v)
      ? filtro.selection.filter((x) => x !== v)
      : [...filtro.selection, v];
    // Desmarcar tudo é o mesmo que marcar tudo — as duas coisas significam "sem
    // recorte" —, e um painel vazio por desmarcar seria um beco sem saída.
    onSelecionar(nova.length ? nova : filtro.options.map((o) => o.value));
  }

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        filtro.active ? "border-accent/40 bg-accent-soft/40" : "border-line bg-canvas",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          {filtro.label}
        </span>
        {filtro.active && (
          <span className="rounded bg-accent px-1 py-px text-[9.5px] font-semibold text-white">
            ativo
          </span>
        )}
        {filtro.note && (
          <span title={filtro.note} className="cursor-help text-ink-subtle">
            <Info aria-hidden className="h-3 w-3" />
          </span>
        )}
        <button
          onClick={() => setEditando((v) => !v)}
          aria-expanded={editando}
          aria-label={`Editar o filtro ${filtro.label}`}
          title="Trocar a coluna, o tipo de controle ou o nome"
          className={cn(
            "ml-auto rounded p-0.5 transition-colors duration-150",
            editando ? "text-accent" : "text-ink-subtle hover:text-ink",
          )}
        >
          <Pencil aria-hidden className="h-3 w-3" />
        </button>
        <button
          onClick={onRemover}
          aria-label={`Remover o filtro ${filtro.label}`}
          className="rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-critical"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      </div>

      {editando && (
        <Edicao
          filtro={filtro}
          catalogo={catalogo}
          onEditar={onEditar}
          onFechar={() => setEditando(false)}
        />
      )}

      {filtro.kind === "data" ? (
        /* Dois campos de data, e não dois sliders: um controle deslizante sobre
           seis mil dias move três semanas por pixel, e ninguém acerta "1º de
           março de 2020" arrastando. `min`/`max` prendem a escolha ao que a
           base tem — uma data fora deles devolveria zero linhas, e zero linhas
           na tela se lê como "não houve". */
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={String(filtro.selection[0] ?? filtro.min ?? "")}
            min={String(filtro.min ?? "")}
            max={String(filtro.selection[1] ?? filtro.max ?? "")}
            onChange={(e) =>
              onSelecionar([e.target.value, String(filtro.selection[1] ?? filtro.max ?? "")])
            }
            aria-label={`${filtro.label}: de`}
            className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-[11.5px] text-ink outline-none focus:border-accent"
          />
          <span className="shrink-0 text-[11px] text-ink-subtle">até</span>
          <input
            type="date"
            value={String(filtro.selection[1] ?? filtro.max ?? "")}
            min={String(filtro.selection[0] ?? filtro.min ?? "")}
            max={String(filtro.max ?? "")}
            onChange={(e) =>
              onSelecionar([String(filtro.selection[0] ?? filtro.min ?? ""), e.target.value])
            }
            aria-label={`${filtro.label}: até`}
            className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-[11.5px] text-ink outline-none focus:border-accent"
          />
        </div>
      ) : filtro.kind === "faixa" ? (
        <div>
          <div className="mb-1 text-[12px] font-medium text-ink [font-variant-numeric:tabular-nums]">
            {faixa[0]} – {faixa[1]}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={filtro.min ?? 0}
              max={filtro.max ?? 100}
              value={faixa[0]}
              onChange={(e) => setFaixa([Math.min(Number(e.target.value), faixa[1]), faixa[1]])}
              onPointerUp={() => onSelecionar(faixa)}
              onKeyUp={() => onSelecionar(faixa)}
              aria-label={`${filtro.label}: mínimo`}
              className="h-1 w-24 cursor-pointer accent-[hsl(var(--accent))]"
            />
            <input
              type="range"
              min={filtro.min ?? 0}
              max={filtro.max ?? 100}
              value={faixa[1]}
              onChange={(e) => setFaixa([faixa[0], Math.max(Number(e.target.value), faixa[0])])}
              onPointerUp={() => onSelecionar(faixa)}
              onKeyUp={() => onSelecionar(faixa)}
              aria-label={`${filtro.label}: máximo`}
              className="h-1 w-24 cursor-pointer accent-[hsl(var(--accent))]"
            />
          </div>
        </div>
      ) : (
        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {filtro.options.map((o) => (
            <button
              key={String(o.value)}
              onClick={() => alternar(o.value)}
              aria-pressed={marcado(o.value)}
              title={o.count ? `${nf.format(o.count)} internações` : undefined}
              className={cn(
                "flex items-baseline gap-1.5 rounded border px-1.5 py-0.5 text-[11px] transition-colors duration-150",
                marcado(o.value)
                  ? "border-accent bg-accent text-white"
                  : "border-line text-ink-muted hover:border-accent/40 hover:text-ink",
              )}
            >
              <span className="font-medium">{o.label}</span>
              {/* Separado por um vão de verdade: colados, o valor "3" e a
                  contagem "85.4M" viravam "385.4M" — um número que não existe. */}
              {o.count > 0 && (
                <span className={cn("text-[10px]", marcado(o.value) ? "opacity-75" : "text-ink-subtle")}>
                  {o.count >= 1e6 ? `${(o.count / 1e6).toFixed(1)}M` : nf.format(o.count)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
