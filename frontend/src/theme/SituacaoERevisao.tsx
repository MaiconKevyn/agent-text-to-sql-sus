import { AlertTriangle, CircleDashed, Scale } from "lucide-react";
import { useState } from "react";
import { SeloDePapel } from "@/components/theme/PapelDoAchado";
import type { Theme } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * O que mudou, e o que espera por uma pessoa.
 *
 * Tudo aqui é DERIVADO do que o tema já devolve — nenhum campo novo, nenhuma
 * rota nova. `pinnedAt` dá o digesto, `role` dá as contradições e os achados sem
 * papel, e `stale` dá as respostas que ficaram sob um recorte que não vale mais.
 *
 * Derivar em vez de guardar não é economia: um contador salvo teria de ser
 * atualizado em todo caminho que mexe num achado, e o primeiro que esquecesse
 * deixaria a tela afirmando um número que não é verdade. Contar na leitura não
 * tem como divergir.
 */
export function SituacaoERevisao({ tema }: { tema: Theme }) {
  const [dias, setDias] = useState(14);
  const blocos = tema.blocks ?? [];

  const corte = Date.now() - dias * 86_400_000;
  const recentes = blocos
    .filter((b) => Date.parse(b.pinnedAt) >= corte)
    .sort((a, b) => Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt));

  const contradicoes = blocos.filter((b) => b.role === "contradiz");
  const semPapel = blocos.filter((b) => !b.role);
  const desatualizadas = tema.questions.filter((q) => q.stale);
  const semApoio = tema.questions.filter(
    (q) =>
      q.answeredAt &&
      !q.stale &&
      q.cited.every((id) => blocos.find((b) => b.id === id)?.weight !== "material"),
  );

  const nadaAResolver =
    contradicoes.length === 0 &&
    semPapel.length === 0 &&
    desatualizadas.length === 0 &&
    semApoio.length === 0;

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h3 className="text-[12.5px] font-semibold text-ink">
            O que mudou nos últimos{" "}
            <input
              type="number"
              min={1}
              max={365}
              value={dias}
              onChange={(e) => setDias(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              aria-label="Janela do resumo, em dias"
              className="w-12 rounded border border-line bg-canvas px-1 py-px text-center text-[12px] tabular-nums text-ink outline-none focus:border-accent"
            />{" "}
            dias
          </h3>
          <span className="text-[11px] text-ink-subtle">
            {recentes.length} achado{recentes.length === 1 ? "" : "s"} · {tema.questions.length}{" "}
            pergunta{tema.questions.length === 1 ? "" : "s"} no tema
          </span>
        </div>

        {recentes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[11.5px] text-ink-subtle">
            Nada entrou nesta janela. Aumente os dias para ver mais atrás.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {recentes.map((b) => (
              <li key={b.id} className="flex items-baseline gap-2 px-3 py-1.5">
                <SeloDePapel papel={b.role} peso={b.weight} compacto />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                  {b.title || b.question}
                </span>
                <span className="shrink-0 text-[10px] text-ink-subtle">{haQuanto(b.pinnedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[12.5px] font-semibold text-ink">Precisa de você</h3>
        {nadaAResolver ? (
          <p className="rounded-lg border border-positive/30 bg-positive-soft px-3 py-2.5 text-[11.5px] text-ink">
            Nada pendente: todo achado diz o que prova, nenhuma resposta ficou sob um recorte
            vencido, e as conclusões apontam para achados materiais.
          </p>
        ) : (
          <div className="space-y-2">
            {/* A definição alterada vem primeiro: é a única pendência que muda
                um número já escrito na tela. As outras são de organização. */}
            <Pendencia
              tom="alerta"
              icone={AlertTriangle}
              titulo={`${desatualizadas.length} resposta(s) sob um recorte que mudou`}
              mostrar={desatualizadas.length > 0}
              explicacao="As definições do tema mudaram depois que estas respostas saíram. O número continua sendo o que o banco devolveu — mas sob um recorte que não é mais o que está em vigor. Refaça pelo botão da pergunta."
              itens={desatualizadas.map((q) => q.text)}
            />
            <Pendencia
              tom="alerta"
              icone={Scale}
              titulo={`${contradicoes.length} achado(s) contradizem o argumento`}
              mostrar={contradicoes.length > 0}
              explicacao="Não é um erro — é o que uma investigação honesta produz. Está aqui para não passar despercebido no meio dos outros."
              itens={contradicoes.map((b) => b.title || b.question)}
            />
            <Pendencia
              tom="neutro"
              icone={CircleDashed}
              titulo={`${semApoio.length} resposta(s) sem achado material`}
              mostrar={semApoio.length > 0}
              explicacao="A conclusão cita achados, mas nenhum deles foi marcado como material — então não dá para dizer o que aconteceria se um caísse."
              itens={semApoio.map((q) => q.text)}
            />
            <Pendencia
              tom="neutro"
              icone={CircleDashed}
              titulo={`${semPapel.length} achado(s) não dizem o que provam`}
              mostrar={semPapel.length > 0}
              explicacao="Coletados, mas fora do argumento: sem papel, eles não sustentam nem derrubam nada."
              itens={semPapel.map((b) => b.title || b.question)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function Pendencia({
  tom,
  icone: Icone,
  titulo,
  explicacao,
  itens,
  mostrar,
}: {
  tom: "alerta" | "neutro";
  icone: typeof AlertTriangle;
  titulo: string;
  explicacao: string;
  itens: string[];
  mostrar: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  if (!mostrar) return null;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tom === "alerta" ? "border-caution/50 bg-caution-soft" : "border-line bg-surface",
      )}
    >
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 text-left"
      >
        <Icone
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0", tom === "alerta" ? "text-caution" : "text-ink-subtle")}
        />
        <span className="min-w-0 flex-1 text-[12px] font-medium text-ink">{titulo}</span>
        <span className="shrink-0 text-[10px] text-ink-subtle">{aberto ? "menos" : "ver"}</span>
      </button>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{explicacao}</p>
      {aberto && (
        <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
          {itens.map((t, i) => (
            <li key={i} className="truncate text-[11px] text-ink-muted">
              · {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "há 2 dias" a partir de um ISO. Sem biblioteca: é uma subtração. */
function haQuanto(iso: string): string {
  const dias = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias}d`;
}
