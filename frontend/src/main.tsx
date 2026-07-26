import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Rota de laboratório para comparar bibliotecas de gráfico: /?lab
//
// Precisa ser `lazy`: o lab importa o Recharts, e num import estático ele
// entrava no bundle principal — 120 KB gzip de biblioteca que o produto não
// usa, carregados por todo usuário que abre o chat.
const Lab = lazy(() => import("./lab/Lab"));

// A investigação é uma ABA à parte, não uma seção do chat. Os ciclos de vida
// são opostos — o chat é efêmero e limpar a conversa é normal; o tema existe
// para não perder nada — e misturá-los faria o chat carregar um ciclo de vida
// que não é o dele. `lazy` porque a maioria das sessões nunca abre esta tela.
const ThemePage = lazy(() => import("./theme/ThemePage"));

const params = new URLSearchParams(location.search);
const lab = params.has("lab");
const investigacao = params.has("temas") || params.has("tema");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {lab ? (
      <Suspense fallback={<div className="p-6 text-ink-muted">Carregando o laboratório…</div>}>
        <Lab />
      </Suspense>
    ) : investigacao ? (
      <Suspense fallback={<div className="p-6 text-ink-muted">Carregando…</div>}>
        <ThemePage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
