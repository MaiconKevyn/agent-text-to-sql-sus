import { useCallback, useEffect, useState } from "react";
import { createTheme, listThemes, pinBlock } from "@/lib/api";
import type { Theme, ThemeBlock } from "@/lib/types";

const ULTIMO = "sih-ultimo-tema";

/**
 * A ponte entre o chat e os temas.
 *
 * Vive fora do `useChat` de propósito: o chat é efêmero — limpar a conversa é
 * uma operação normal — e o tema existe para não perder nada. Misturar os dois
 * faria o chat carregar um ciclo de vida que não é o dele.
 *
 * A lista é só de metadados; os blocos só são lidos ao abrir um tema.
 */
export function useThemes() {
  const [temas, setTemas] = useState<Theme[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // O último tema usado, para o botão "fixar" ter um destino óbvio em vez de
  // abrir um seletor a cada vez.
  const [ultimoId, setUltimoId] = useState<string | null>(
    () => localStorage.getItem(ULTIMO),
  );

  const recarregar = useCallback(async () => {
    try {
      setTemas(await listThemes());
      setErro(null);
    } catch (e) {
      setErro(String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const lembrar = useCallback((id: string) => {
    setUltimoId(id);
    try {
      localStorage.setItem(ULTIMO, id);
    } catch {
      /* modo privado: segue sem lembrar */
    }
  }, []);

  const criar = useCallback(
    async (titulo: string) => {
      const t = await createTheme(titulo);
      lembrar(t.id);
      await recarregar();
      return t;
    },
    [lembrar, recarregar],
  );

  /** Fixa num tema existente, ou cria um na hora se ainda não houver nenhum. */
  const fixar = useCallback(
    async (bloco: Partial<ThemeBlock>, temaId?: string) => {
      let destino = temaId ?? ultimoId;
      if (!destino) {
        const titulo = bloco.question?.slice(0, 60) || "Nova investigação";
        destino = (await createTheme(titulo)).id;
      }
      await pinBlock(destino, bloco);
      lembrar(destino);
      await recarregar();
      return destino;
    },
    [lembrar, recarregar, ultimoId],
  );

  const ultimo = temas.find((t) => t.id === ultimoId) ?? null;

  return { temas, ultimo, carregando, erro, criar, fixar, recarregar, lembrar };
}
