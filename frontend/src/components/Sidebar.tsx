import { Bookmark, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteChat, deleteTheme, listChats, listThemes } from "@/lib/api";
import type { SavedChat, Theme } from "@/lib/types";

type Aba = "temas" | "chats";

interface Props {
  /** Qual item está aberto agora, para destacá-lo na lista. */
  atual?: { tipo: Aba; id: string } | null;
  onNovoChat: () => void;
  onAbrirChat: (id: string) => void;
  onAbrirTema: (id: string) => void;
  onNovoTema: () => void;
  /** Sobe a cada mudança que a lista precisa refletir. */
  versao?: number;
}

// Quantas conversas aparecem antes do "ver todas". A maioria das conversas é
// uma pergunta e pronto; sem um corte, a lista de rascunhos soterra os temas.
const CHATS_VISIVEIS = 10;

/**
 * Navegação entre os dois objetos do produto.
 *
 * Temas e chats NÃO têm o mesmo peso, e a barra não finge que têm: o tema é
 * artefato — acumula, ganha anotação, vira contexto das perguntas seguintes — e
 * o chat é rascunho, salvo só para você poder voltar. Por isso Temas fica em
 * cima e a lista de chats é cortada; se as duas listas crescessem juntas, em
 * dois dias os três temas ficariam soterrados por quarenta conversas de uma
 * pergunta só.
 */
export function Sidebar({
  atual,
  onNovoChat,
  onAbrirChat,
  onAbrirTema,
  onNovoTema,
  versao = 0,
}: Props) {
  const [aba, setAba] = useState<Aba>(atual?.tipo ?? "chats");
  const [temas, setTemas] = useState<Theme[]>([]);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [todos, setTodos] = useState(false);

  useEffect(() => {
    void listThemes().then(setTemas).catch(() => setTemas([]));
    void listChats().then(setChats).catch(() => setChats([]));
  }, [versao]);

  const lista = aba === "temas" ? temas : chats;
  const visiveis = aba === "chats" && !todos ? chats.slice(0, CHATS_VISIVEIS) : lista;

  async function apagar(id: string) {
    if (aba === "temas") {
      await deleteTheme(id);
      setTemas((ts) => ts.filter((t) => t.id !== id));
    } else {
      await deleteChat(id);
      setChats((cs) => cs.filter((c) => c.id !== id));
    }
  }

  return (
    <nav
      aria-label="Conversas e investigações"
      className="flex h-full w-full flex-col border-r border-line bg-raised"
    >
      <div className="p-2">
        <div className="flex gap-1 rounded-lg bg-canvas p-1">
          {(["temas", "chats"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              aria-pressed={aba === a}
              className={
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 " +
                "text-[12.5px] font-medium transition-colors duration-150 " +
                (aba === a
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink")
              }
            >
              {a === "temas" ? (
                <Bookmark aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <MessagesSquare aria-hidden className="h-3.5 w-3.5" />
              )}
              {a === "temas" ? "Temas" : "Chats"}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2 pb-1">
        <button
          onClick={aba === "temas" ? onNovoTema : onNovoChat}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {aba === "temas" ? "Nova investigação" : "Nova conversa"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visiveis.length === 0 && (
          <p className="px-2.5 py-6 text-center text-[11.5px] leading-relaxed text-ink-subtle">
            {aba === "temas"
              ? "Nenhuma investigação. Fixe uma resposta para começar."
              : "Nenhuma conversa salva ainda."}
          </p>
        )}

        <ul className="space-y-0.5">
          {visiveis.map((item) => {
            const ativo = atual?.tipo === aba && atual.id === item.id;
            const contagem =
              "blockCount" in item ? item.blockCount : (item as SavedChat).turnCount;
            return (
              <li key={item.id} className="group relative">
                <button
                  onClick={() =>
                    aba === "temas" ? onAbrirTema(item.id) : onAbrirChat(item.id)
                  }
                  className={
                    "flex w-full items-baseline gap-2 rounded-lg py-1.5 pl-2.5 pr-8 text-left " +
                    "transition-colors duration-150 " +
                    (ativo ? "bg-surface text-ink" : "text-ink-muted hover:bg-surface hover:text-ink")
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {item.title || "Sem título"}
                  </span>
                  {contagem > 0 && (
                    <span className="shrink-0 text-[10.5px] text-ink-subtle">{contagem}</span>
                  )}
                </button>
                <button
                  onClick={() => void apagar(item.id)}
                  aria-label={`Apagar ${item.title || "sem título"}`}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-critical group-hover:block"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>

        {aba === "chats" && !todos && chats.length > CHATS_VISIVEIS && (
          <button
            onClick={() => setTodos(true)}
            className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-ink-subtle transition-colors duration-150 hover:text-ink"
          >
            ver todas as {chats.length}
          </button>
        )}
      </div>
    </nav>
  );
}
