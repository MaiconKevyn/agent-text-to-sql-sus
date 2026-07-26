import { Bookmark, MessagesSquare } from "lucide-react";
import type { Aba } from "./Sidebar";
import { cn } from "@/lib/utils";

interface Props {
  aba: Aba;
  /**
   * Se a lista ao lado está aberta. Na tela do tema não há lista — o trilho
   * navega — e o destaque marca só em que área do produto se está.
   */
  aberto: boolean;
  /** Trocar de seção, ou fechar a lista quando a seção já é a atual. */
  onEscolher: (aba: Aba) => void;
}

const SECOES: { id: Aba; rotulo: string; Icone: typeof Bookmark }[] = [
  { id: "temas", rotulo: "Temas", Icone: Bookmark },
  { id: "chats", rotulo: "Chats", Icone: MessagesSquare },
];

/**
 * A coluna fixa da esquerda: onde se escolhe entre Temas e Chats.
 *
 * O trilho NUNCA sai — nem com a lista fechada. É o que separa duas perguntas
 * que antes se misturavam num só painel: "onde eu estou" (aqui, sempre à vista)
 * e "o que tem aqui" (a lista ao lado, que abre e fecha). Com as abas dentro da
 * lista, recolher a barra levava as duas embora, e voltar a Temas exigia
 * reabrir primeiro.
 *
 * Clicar na seção que já está aberta fecha a lista — é o mesmo gesto de ida e
 * volta, no mesmo lugar, e dispensa um botão separado de recolher.
 */
export function TrilhoDeSecoes({ aba, aberto, onEscolher }: Props) {
  return (
    <nav
      aria-label="Seções"
      className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-raised pt-2 lg:flex"
    >
      {SECOES.map(({ id, rotulo, Icone }) => {
        const ativa = aberto && aba === id;
        return (
          <button
            key={id}
            onClick={() => onEscolher(id)}
            aria-pressed={ativa}
            // O título diz o que o clique FAZ, que muda conforme o estado: com a
            // lista já aberta nesta seção, clicar fecha.
            title={ativa ? `Fechar ${rotulo}` : rotulo}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150",
              ativa
                ? "bg-accent-soft text-accent"
                : "text-ink-subtle hover:bg-surface hover:text-ink",
            )}
          >
            <Icone aria-hidden className="h-[18px] w-[18px]" />
            <span className="sr-only">{rotulo}</span>
          </button>
        );
      })}
    </nav>
  );
}
