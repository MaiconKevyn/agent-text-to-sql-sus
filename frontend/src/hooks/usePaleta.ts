import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { acharPaleta, aplicarPaleta, PALETA_PADRAO } from "@/lib/paletas";
import { useTheme } from "./useTheme";

const CHAVE = "sih-paleta";

/** Um evento próprio, para todas as instâncias do hook reagirem à troca. */
const EVENTO = "sih-paleta-mudou";

function lerSalva(): string {
  try {
    return localStorage.getItem(CHAVE) || PALETA_PADRAO;
  } catch {
    return PALETA_PADRAO;
  }
}

/**
 * A paleta do site, persistida em localStorage.
 *
 * O estado vive num evento no `window` e não num contexto do React de propósito:
 * o hook é chamado em lugares que não compartilham árvore (o cabeçalho do chat,
 * o cabeçalho do tema), e um `useState` por chamada faria o seletor de um lugar
 * não atualizar o outro. Já aconteceu neste projeto com o modo claro/escuro: só
 * a instância do cabeçalho reagia, e o gráfico continuava desenhando a paleta
 * antiga.
 *
 * A paleta pode FIXAR um modo — o Darcula é escuro por natureza, e mostrá-lo em
 * claro seria mostrar outra coisa com o nome dele. Escolher uma paleta assim
 * troca o modo junto.
 */
export function usePaleta() {
  const { theme, setTheme } = useTheme();
  const [id, setId] = useState<string>(lerSalva);

  useEffect(() => {
    const aoMudar = () => setId(lerSalva());
    addEventListener(EVENTO, aoMudar);
    addEventListener("storage", aoMudar);
    return () => {
      removeEventListener(EVENTO, aoMudar);
      removeEventListener("storage", aoMudar);
    };
  }, []);

  // Reaplica quando a paleta OU o modo muda: os tokens são diferentes nos dois.
  useEffect(() => {
    aplicarPaleta(document.documentElement, id, theme);
  }, [id, theme]);

  const escolher = useCallback(
    (novo: string) => {
      try {
        localStorage.setItem(CHAVE, novo);
      } catch {
        /* modo privado: segue sem persistir */
      }
      const p = acharPaleta(novo);
      if (p.fixo && p.fixo !== theme) setTheme(p.fixo);
      setId(novo);
      dispatchEvent(new Event(EVENTO));
    },
    [theme, setTheme],
  );

  return { paleta: id, escolher, modo: theme };
}

/**
 * A paleta que vale NESTE pedaço da árvore.
 *
 * Existe porque um tema pode ter aparência própria, e a aparência tem de
 * alcançar o gráfico — não só o cromo. Os tokens CSS cascateiam sozinhos a
 * partir do contêiner do tema; o ECharts não lê CSS, então precisa que o id da
 * paleta desça por aqui.
 */
export const PaletaEscopo = createContext<string | null>(null);

/** A do escopo, se houver; senão a do site. */
export function usePaletaEfetiva(): string {
  const escopo = useContext(PaletaEscopo);
  const [global, setGlobal] = useState(lerSalva);
  useEffect(() => {
    const aoMudar = () => setGlobal(lerSalva());
    addEventListener(EVENTO, aoMudar);
    addEventListener("storage", aoMudar);
    return () => {
      removeEventListener(EVENTO, aoMudar);
      removeEventListener("storage", aoMudar);
    };
  }, []);
  return escopo || global;
}
