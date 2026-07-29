import { AlertCircle, Check, Clock, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ListaDeEtapas } from "./controles";
import { MAX_SIMULTANEAS, type EstadoTarefa, type Tarefa } from "./useFilaDePedidos";

const ICONE: Record<EstadoTarefa, typeof Check> = {
  "na-fila": Clock,
  rodando: Loader2,
  pronta: Check,
  recusada: AlertCircle,
  falhou: AlertCircle,
};

const COR: Record<EstadoTarefa, string> = {
  "na-fila": "text-ink-subtle",
  rodando: "text-accent",
  pronta: "text-positive",
  recusada: "text-caution",
  falhou: "text-critical",
};

const ROTULO: Record<EstadoTarefa, string> = {
  "na-fila": "na fila",
  rodando: "montando…",
  pronta: "pronto",
  recusada: "não deu",
  falhou: "erro",
};

interface Props {
  tarefas: Tarefa[];
  onDispensar: (id: string) => void;
  onLimpar: () => void;
}

/**
 * A fila de pedidos, flutuando no canto, com o relato do que está acontecendo.
 *
 * Fica fora do fluxo da página porque o painel continua utilizável enquanto os
 * pedidos rodam — dá para arrastar um widget, mexer num filtro, abrir uma lupa.
 * Uma lista no meio do conteúdo empurraria a tela a cada pedido novo, e o que
 * se está olhando pularia de lugar.
 *
 * A ordem é de chegada, e não por estado: quem enfileirou três pedidos espera
 * vê-los na ordem em que digitou. Reordenar por "rodando primeiro" faria os
 * cartões trocarem de lugar sozinhos, e um cartão que se move é um cartão que
 * se lê duas vezes.
 */
export function PainelDeTarefas({ tarefas, onDispensar, onLimpar }: Props) {
  if (tarefas.length === 0) return null;

  const rodando = tarefas.filter((t) => t.estado === "rodando").length;
  const esperando = tarefas.filter((t) => t.estado === "na-fila").length;
  const concluidas = tarefas.filter((t) => t.estado !== "rodando" && t.estado !== "na-fila").length;

  return (
    <aside
      aria-label="Pedidos em andamento"
      // `aria-live` porque o estado muda sem ninguém clicar: quem usa leitor de
      // tela precisa saber que um pedido terminou.
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-[21rem] rounded-xl border border-line bg-surface shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
          Pedidos
        </span>
        <span className="text-[11px] text-ink-muted">
          {rodando > 0 && `${rodando}/${MAX_SIMULTANEAS} rodando`}
          {rodando > 0 && esperando > 0 && " · "}
          {esperando > 0 && `${esperando} na fila`}
        </span>
        {concluidas > 0 && (
          <button
            onClick={onLimpar}
            className="rounded px-1 text-[11px] text-ink-subtle transition-colors duration-150 hover:text-ink"
          >
            limpar
          </button>
        )}
      </header>

      <ul className="max-h-[26rem] space-y-px overflow-y-auto p-1">
        {tarefas.map((t) => {
          const Icone = ICONE[t.estado];
          return (
            <li
              key={t.id}
              className={cn(
                "rounded-lg px-2 py-1.5 transition-colors duration-150",
                t.estado === "rodando" && "bg-accent-soft/50",
              )}
            >
              <div className="flex items-start gap-2">
                <Icone
                  aria-hidden
                  className={cn(
                    "mt-px h-3.5 w-3.5 shrink-0",
                    COR[t.estado],
                    t.estado === "rodando" && "animate-spin",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-[12px] leading-snug",
                      t.estado === "pronta" ? "text-ink-muted" : "text-ink",
                    )}
                    title={t.pedido}
                  >
                    {t.pedido}
                  </p>
                  <p className={cn("text-[10.5px] leading-snug", COR[t.estado])}>
                    {ROTULO[t.estado]}
                    {t.tipo && t.estado === "pronta" && ` · ${t.tipo}`}
                    {/* De qual análise o pedido veio. Sem isto, doze cartões
                        aparecendo de uma vez parecem doze coisas que alguém
                        pediu uma a uma. */}
                    {t.origem && (
                      <span className="text-ink-subtle"> · de &ldquo;{t.origem}&rdquo;</span>
                    )}
                  </p>
                  {/* A recusa vai INTEIRA: ela é a única coisa deste cartão que
                      não está visível em nenhum outro lugar da tela. */}
                  {t.mensagem && (
                    <p className="mt-1 rounded bg-canvas px-1.5 py-1 text-[10.5px] leading-relaxed text-ink-muted">
                      {t.mensagem}
                    </p>
                  )}
                </div>
                {(t.estado === "recusada" || t.estado === "falhou") && (
                  <button
                    onClick={() => onDispensar(t.id)}
                    aria-label={`Dispensar: ${t.pedido}`}
                    className="rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-ink"
                  >
                    <X aria-hidden className="h-3 w-3" />
                  </button>
                )}
              </div>

              {t.etapas.length > 0 && (
                <ListaDeEtapas etapas={t.etapas} compacta extra={() => <Cronometro />} />
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/* ------------------------------------------------------------------------- */

/** Segundos desde que a etapa começou. Reinicia a cada etapa por causa da key. */
function Cronometro() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  // Antes de um segundo não há o que mostrar, e "0s" piscando em toda etapa
  // instantânea — ler o dicionário, conferir o SQL — seria ruído.
  if (s < 1) return null;
  return <span className="shrink-0 text-[9.5px] tabular-nums text-ink-subtle">{s}s</span>;
}
