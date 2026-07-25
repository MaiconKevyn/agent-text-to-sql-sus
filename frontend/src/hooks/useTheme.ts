import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "sih-theme";

/**
 * Tema persistido em localStorage, com `prefers-color-scheme` como padrão no
 * primeiro acesso. O valor inicial é lido do <html>, que o script inline do
 * index.html já aplicou antes da primeira pintura — por isso não há flash.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* modo privado: segue sem persistir */
    }
  }, [theme]);

  // Acompanha o sistema enquanto o usuário não tiver escolhido explicitamente.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      let escolhido: string | null = null;
      try {
        escolhido = localStorage.getItem(KEY);
      } catch {
        /* ignora */
      }
      if (!escolhido) setTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, setTheme, toggle };
}
