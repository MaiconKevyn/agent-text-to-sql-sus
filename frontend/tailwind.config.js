/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Todos os tokens vêm de variáveis CSS em index.css, definidas uma vez
        // por tema. Componentes nunca escolhem cor crua.
        canvas: "hsl(var(--canvas) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        raised: "hsl(var(--raised) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        "line-strong": "hsl(var(--line-strong) / <alpha-value>)",
        ink: "hsl(var(--ink) / <alpha-value>)",
        "ink-muted": "hsl(var(--ink-muted) / <alpha-value>)",
        "ink-subtle": "hsl(var(--ink-subtle) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        "accent-hover": "hsl(var(--accent-hover) / <alpha-value>)",
        "accent-ink": "hsl(var(--accent-ink) / <alpha-value>)",
        "accent-soft": "hsl(var(--accent-soft) / <alpha-value>)",
        positive: "hsl(var(--positive) / <alpha-value>)",
        caution: "hsl(var(--caution) / <alpha-value>)",
        "caution-soft": "hsl(var(--caution-soft) / <alpha-value>)",
        critical: "hsl(var(--critical) / <alpha-value>)",
        "critical-soft": "hsl(var(--critical-soft) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { xl: "0.75rem", "2xl": "1rem" },
      boxShadow: {
        subtle: "0 1px 2px 0 hsl(var(--shadow) / 0.05)",
        raised: "0 1px 3px 0 hsl(var(--shadow) / 0.08), 0 1px 2px -1px hsl(var(--shadow) / 0.06)",
        panel: "0 4px 16px -4px hsl(var(--shadow) / 0.12)",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.16, 1, 0.3, 1)" },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        blink: { "0%, 45%": { opacity: "1" }, "50%, 95%": { opacity: "0" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-up": "fade-up 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
        blink: "blink 1.1s steps(1) infinite",
      },
    },
  },
  plugins: [],
};
