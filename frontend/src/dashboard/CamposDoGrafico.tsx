import { useEffect } from "react";
import type { ChartKind, PanelCatalog, WidgetDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Campo, SELECT, porGrupo } from "./controles";

interface Props {
  catalogo: PanelCatalog;
  valor: WidgetDraft;
  onMudar: (v: WidgetDraft) => void;
}

/**
 * As escolhas que definem um gráfico: medida, eixo, série, forma, ordem, limite.
 *
 * Mora aqui porque DOIS lugares precisam exatamente delas — o menu, que cria, e
 * o editor, que refaz. Se cada um tivesse a sua cópia, um ganharia uma opção que
 * o outro não tem, e "editar" passaria a mudar coisas que ninguém tocou.
 *
 * O componente não guarda estado: quem chama é dono do rascunho. É o que permite
 * ao editor abrir já preenchido com o que o widget guardou.
 */
export function CamposDoGrafico({ catalogo, valor, onMudar }: Props) {
  const troca = (mudanca: Partial<WidgetDraft>) => onMudar({ ...valor, ...mudanca });

  const m = catalogo.measures.find((x) => x.id === valor.measure);
  const c = catalogo.fields.find((x) => x.id === valor.field);
  const s = catalogo.fields.find((x) => x.id === valor.series);
  const indicador = !valor.field;

  // Séries possíveis: só as de poucas categorias, e nunca o próprio eixo.
  const seriesPossiveis = catalogo.fields.filter((f) => f.canSeries && f.id !== valor.field);
  const formaAtual = catalogo.forms.find((f) => f.id === valor.form);

  useEffect(() => {
    if (valor.series && !seriesPossiveis.some((f) => f.id === valor.series)) {
      onMudar({ ...valor, series: "" });
    }
    // Uma forma que exige série fica impossível sem ela; se estava escolhida,
    // volta para barras em vez de deixar o botão recusando sozinho.
    else if (formaAtual?.needsSeries && !valor.series) {
      onMudar({ ...valor, form: "barra" });
    }
  }, [valor, seriesPossiveis, formaAtual, onMudar]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Medida" dica={m?.note}>
          <select
            value={valor.measure}
            onChange={(e) => troca({ measure: e.target.value })}
            className={SELECT}
          >
            {catalogo.measures.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Agrupar por" dica={c?.note}>
          <select
            value={valor.field}
            onChange={(e) => troca({ field: e.target.value })}
            className={SELECT}
          >
            <option value="">— nenhum: só o número —</option>
            {/* `canGroup` tira do eixo o que só serve para recortar: agrupar
                por data crua daria 5.844 barras, uma por dia da base. */}
            {porGrupo(catalogo.fields.filter((f) => f.canGroup)).map(([grupo, campos]) => (
              <optgroup key={grupo} label={grupo}>
                {campos.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Campo>
      </div>

      {!indicador && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo="Separar em séries"
              dica={
                s?.note ??
                "Só campos com poucas categorias: acima de doze, a legenda fica maior que o gráfico."
              }
            >
              <select
                value={valor.series}
                onChange={(e) => troca({ series: e.target.value })}
                className={SELECT}
              >
                <option value="">— série única —</option>
                {seriesPossiveis.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Forma">
              <div className="flex flex-wrap gap-1">
                {catalogo.forms.map((f) => {
                  const bloqueada = f.needsSeries && !valor.series;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={bloqueada}
                      onClick={() => troca({ form: f.id as ChartKind })}
                      aria-pressed={valor.form === f.id}
                      title={bloqueada ? `${f.label} exige uma série` : f.label}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[11.5px] transition-colors duration-150",
                        valor.form === f.id
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line text-ink-muted hover:text-ink",
                        bloqueada && "cursor-not-allowed opacity-35 hover:text-ink-muted",
                      )}
                    >
                      {f.label.replace(/ \(.*\)/, "")}
                    </button>
                  );
                })}
              </div>
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo="Ordem"
              dica={
                c?.ordinal
                  ? "Este campo é ordinal: o eixo sai em ordem de categoria de qualquer forma, senão a linha ligaria anos fora de ordem."
                  : undefined
              }
            >
              <select
                value={valor.order}
                onChange={(e) => troca({ order: e.target.value })}
                disabled={!!valor.series}
                className={cn(SELECT, valor.series && "opacity-50")}
                title={valor.series ? "Com série, o eixo ordena pela categoria" : undefined}
              >
                {catalogo.orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo={`Quantas categorias — ${valor.limit}`}>
              <input
                type="range"
                min={3}
                max={60}
                value={valor.limit}
                onChange={(e) => troca({ limit: Number(e.target.value) })}
                className="h-1 w-full cursor-pointer accent-[hsl(var(--accent))]"
                aria-label="Quantas categorias"
              />
            </Campo>
          </div>
        </>
      )}

      <Campo rotulo="Título">
        <input
          value={valor.title}
          onChange={(e) => troca({ title: e.target.value })}
          placeholder={m && c ? `${m.label} por ${c.label}` : (m?.label ?? "")}
          className={SELECT}
        />
      </Campo>
    </>
  );
}

/** O resumo em uma linha do que aquelas escolhas produzem. */
export function ResumoDoGrafico({
  catalogo,
  valor,
}: {
  catalogo: PanelCatalog;
  valor: WidgetDraft;
}) {
  const m = catalogo.measures.find((x) => x.id === valor.measure);
  const c = catalogo.fields.find((x) => x.id === valor.field);
  const s = catalogo.fields.find((x) => x.id === valor.series);
  return (
    <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-subtle">
      {m && (valor.field ? `${m.label} por ${c?.label}` : m.label)}
      {s && `, separado por ${s.label}`}
      {m && m.minCases > 0 && (
        <span className="text-caution">
          {" "}
          · grupos com menos de {m.minCases.toLocaleString("pt-BR")} internações ficam de fora
        </span>
      )}
    </p>
  );
}

/** O rascunho de um gráfico novo. */
export const RASCUNHO_VAZIO: WidgetDraft = {
  measure: "internacoes",
  field: "ano",
  series: "",
  form: "linha",
  order: "valor_desc",
  limit: 15,
  title: "",
};
