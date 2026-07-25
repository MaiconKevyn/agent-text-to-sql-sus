import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Lab from "./lab/Lab";
import "./index.css";

// Rota de laboratório para comparar bibliotecas de gráfico: /?lab
const lab = new URLSearchParams(location.search).has("lab");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{lab ? <Lab /> : <App />}</StrictMode>,
);
