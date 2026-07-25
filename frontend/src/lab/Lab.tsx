import { useState } from "react";
import * as Rech from "./charts/Recharts";
import * as ECh from "./charts/ECharts";
import dados from "./dados.json";
import { useTheme } from "@/hooks/useTheme";

const FRAMEWORKS = [
  { nome: "Recharts", mod: Rech, peso: "120 KB gzip" },
  { nome: "Apache ECharts", mod: ECh, peso: "205 KB gzip" },
] as const;

const CASOS = [
  {
    id: "LinhaCancer" as const,
    titulo: "Evolução de mortes por câncer",
    forma: "linha · série temporal, 17 pontos",
    n: dados.evolucao_cancer.nRows,
  },
  {
    id: "BarraMunicipios" as const,
    titulo: "Top 5 municípios · óbitos de homens",
    forma: "barra horizontal · ranking, rótulos longos",
    n: dados.top5_municipios.nRows,
  },
  {
    id: "PizzaDiagnosticos" as const,
    titulo: "5 principais diagnósticos",
    forma: "parte-do-todo · pizza foi o pedido",
    n: dados.top5_diagnosticos.nRows,
  },
  {
    id: "BarrasSexo" as const,
    titulo: "Respiratórias por sexo · 2020-2022",
    forma: "barra agrupada · 2 séries × 3 anos",
    n: dados.respiratoria_sexo.nRows,
  },
  {
    id: "BarrasUF" as const,
    titulo: "Internações por UF",
    forma: "alta cardinalidade · 27 rótulos no eixo",
    n: dados.internacoes_por_uf.nRows,
  },
  {
    id: "HistogramaIdade" as const,
    titulo: "Distribuição de idade dos pacientes",
    forma: "histograma · barras encostadas, eixo contínuo",
    n: dados.distribuicao_idade.nRows,
  },
  {
    id: "HeatmapSazonalidade" as const,
    titulo: "Sazonalidade · mês × ano",
    forma: "matriz 16×12 · o Recharts não tem heatmap",
    n: dados.sazonalidade_mes_ano.nRows,
  },
  {
    id: "LinhasRegiao" as const,
    titulo: "Evolução por região",
    forma: "5 séries no tempo · limite da paleta categórica",
    n: dados.evolucao_por_regiao.nRows,
  },
  {
    id: "DispersaoCustoPermanencia" as const,
    titulo: "Custo médio × permanência por UF",
    forma: "dispersão · 3ª dimensão no tamanho do ponto",
    n: dados.custo_x_permanencia_uf.nRows,
  },
  {
    id: "EmpilhadaCarater" as const,
    titulo: "Caráter da internação ao longo do tempo",
    forma: "empilhada 100% · a pergunta é proporção",
    n: dados.carater_por_ano.nRows,
  },
];

export default function Lab() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  // `null` = todos; um nome = só ele; "duelo" = Recharts vs ECharts lado a lado.
  const [soUm, setSoUm] = useState<string | null>("duelo");
  const visiveis =
    soUm === "duelo"
      ? FRAMEWORKS.filter((f) => f.nome === "Recharts" || f.nome === "Apache ECharts")
      : soUm
        ? FRAMEWORKS.filter((f) => f.nome === soUm)
        : FRAMEWORKS;

  return (
    <div className="min-h-full bg-canvas px-5 py-6">
      <header className="mx-auto mb-6 flex max-w-[1500px] flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Comparação de bibliotecas de gráfico
          </h1>
          <p className="text-[12.5px] text-ink-muted">
            Dez casos, dados reais do SIH/SUS, mesma paleta validada. Recharts × Apache ECharts.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {["duelo", null, ...FRAMEWORKS.map((f) => f.nome)].map((n) => (
            <button
              key={n ?? "todos"}
              onClick={() => setSoUm(n)}
              className={
                "rounded-lg border px-2.5 py-1 text-[12px] transition-colors duration-150 " +
                (soUm === n
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-surface text-ink-muted hover:text-ink")
              }
            >
              {n === "duelo" ? "Recharts × ECharts" : (n ?? "Todos")}
            </button>
          ))}
          <button
            onClick={toggle}
            className="ml-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-muted hover:text-ink"
          >
            {dark ? "Tema claro" : "Tema escuro"}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6">
        {CASOS.map((caso) => (
          <section key={caso.id}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-[14px] font-semibold text-ink">{caso.titulo}</h2>
              <span className="text-[11.5px] text-ink-subtle">{caso.forma}</span>
              <span className="text-[11px] text-ink-subtle">· {caso.n} linhas</span>
            </div>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${visiveis.length}, minmax(0, 1fr))` }}
            >
              {visiveis.map((f) => {
                const C = f.mod[caso.id];
                return (
                  <figure
                    key={f.nome}
                    className="overflow-hidden rounded-xl border border-line bg-surface"
                  >
                    <figcaption className="flex items-baseline justify-between border-b border-line px-3 py-1.5">
                      <span className="text-[11.5px] font-medium text-ink-muted">{f.nome}</span>
                      <span className="text-[10.5px] text-ink-subtle">{f.peso}</span>
                    </figcaption>
                    <div className="flex min-h-[244px] items-center justify-center overflow-x-auto p-2">
                      <C dark={dark} />
                    </div>
                  </figure>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
