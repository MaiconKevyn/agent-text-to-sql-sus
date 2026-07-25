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
const lab = new URLSearchParams(location.search).has("lab");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {lab ? (
      <Suspense fallback={<div className="p-6 text-ink-muted">Carregando o laboratório…</div>}>
        <Lab />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
