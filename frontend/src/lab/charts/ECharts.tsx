import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  VisualMapComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import dados from "../dados.json";
import { MESES, abreviar, chartTheme, nfBR } from "../palette";

// Importar de "echarts" traz o pacote inteiro (~1 MB). O registro explícito é
// o que torna a comparação de peso honesta contra o Recharts.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  HeatmapChart,
  ScatterChart,
  VisualMapComponent,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  LabelLayout,
  SVGRenderer,
]);

interface P {
  dark: boolean;
}

/**
 * O ECharts também é imperativo, mas — ao contrário do Plot — não redesenha
 * sozinho: instância criada uma vez, `setOption` para atualizar, `resize()`
 * na mão. O ResizeObserver aqui é obrigatório, igual ao do Plot.
 */
function Grafico({ option, deps }: { option: echarts.EChartsCoreOption; deps: unknown[] }) {
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts>();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "svg" });
    inst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    // `true` = não faz merge com a opção anterior. Sem isso, trocar de tema
    // deixa séries antigas grudadas.
    inst.current?.setOption(option, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return <div ref={host} className="h-[220px] w-full" />;
}

const textoBase = (t: ReturnType<typeof chartTheme>) => ({
  color: t.inkMuted,
  fontSize: 11,
  fontFamily: "inherit",
});

const tooltipBase = (t: ReturnType<typeof chartTheme>) => ({
  backgroundColor: t.surface,
  borderColor: t.grid,
  borderWidth: 1,
  textStyle: { color: t.ink, fontSize: 12 },
  extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12)",
});

const eixoValor = (t: ReturnType<typeof chartTheme>) => ({
  type: "value" as const,
  axisLabel: { ...textoBase(t), formatter: abreviar },
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: t.grid } },
});

const eixoCategoria = (t: ReturnType<typeof chartTheme>) => ({
  type: "category" as const,
  axisLabel: textoBase(t),
  axisLine: { lineStyle: { color: t.grid } },
  axisTick: { show: false },
});

/** 1. Série temporal — com dataZoom por arrasto, que nenhuma outra dá de graça. */
export function LinhaCancer({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.evolucao_cancer.rows.map(([ano, v]) => [String(ano), Number(v)]);
  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 12, right: 14, bottom: 34, left: 52 },
        xAxis: { ...eixoCategoria(t), data: d.map((r) => r[0]), boundaryGap: false },
        yAxis: eixoValor(t),
        tooltip: {
          trigger: "axis",
          ...tooltipBase(t),
          // `trigger: axis` dá a crosshair vertical sem nenhum código extra.
          axisPointer: { type: "line", lineStyle: { color: t.grid } },
          valueFormatter: (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v)),
        },
        dataZoom: [{ type: "inside" }],
        series: [
          {
            type: "line",
            data: d.map((r) => r[1]),
            smooth: 0.2,
            showSymbol: false,
            lineStyle: { color: t.serie[0], width: 2 },
            itemStyle: { color: t.serie[0] },
          },
        ],
      }}
    />
  );
}

/** 2. Ranking — rótulo direto na ponta da barra, sem cálculo manual. */
export function BarraMunicipios({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_municipios.rows.map(([, nome, uf, v]) => ({
    rotulo: `${nome}/${uf}`,
    v: Number(v),
  }));
  return (
    <Grafico
      deps={[dark]}
      option={{
        // `containLabel` reserva espaço para o rótulo mas não o protege da
        // borda do canvas; com left: 8 o "B" de Belo Horizonte era cortado.
        grid: { top: 8, right: 52, bottom: 26, left: 14, containLabel: true },
        xAxis: eixoValor(t),
        // ECharts desenha o eixo de categoria de baixo para cima; inverter
        // devolve a ordem do ranking.
        yAxis: { ...eixoCategoria(t), data: d.map((r) => r.rotulo).reverse() },
        tooltip: {
          trigger: "item",
          ...tooltipBase(t),
          valueFormatter: (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v)),
        },
        series: [
          {
            type: "bar",
            data: d.map((r) => r.v).reverse(),
            barMaxWidth: 20,
            itemStyle: { color: t.serie[0], borderRadius: [0, 4, 4, 0] },
            label: {
              show: true,
              position: "right",
              formatter: (p: { value: number }) => abreviar(p.value),
              ...textoBase(t),
            },
          },
        ],
      }}
    />
  );
}

/** 3. Parte-do-todo — a única das duas com rótulo-guia sem sobreposição. */
export function PizzaDiagnosticos({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_diagnosticos.rows.map(([, nome, v], i) => ({
    name: String(nome),
    value: Number(v),
    itemStyle: { color: t.serie[i], borderColor: t.surface, borderWidth: 2 },
  }));
  const total = d.reduce((s, r) => s + r.value, 0);
  return (
    <Grafico
      deps={[dark]}
      option={{
        tooltip: {
          trigger: "item",
          ...tooltipBase(t),
          formatter: (p: { name: string; value: number; percent: number }) =>
            `${p.name}<br/><b>${nfBR.format(p.value)}</b> · ${String(p.percent).replace(".", ",")}%`,
        },
        legend: {
          type: "scroll",
          orient: "vertical",
          right: 4,
          top: "middle",
          itemWidth: 9,
          itemHeight: 9,
          itemGap: 9,
          textStyle: { ...textoBase(t), fontSize: 10.5 },
          // Truncar aqui, não no `overflow` do textStyle: o corte por largura
          // come o percentual junto com o nome, e o percentual é o dado.
          formatter: (nome: string) => {
            const r = d.find((x) => x.name === nome);
            if (!r) return nome;
            const curto = nome.length > 21 ? nome.slice(0, 20) + "…" : nome;
            return `${curto}  ${((r.value / total) * 100).toFixed(1).replace(".", ",")}%`;
          },
        },
        series: [
          {
            type: "pie",
            radius: ["38%", "68%"],
            center: ["27%", "50%"],
            data: d,
            label: { show: false },
            emphasis: { scale: true, scaleSize: 4 },
          },
        ],
      }}
    />
  );
}

/** 4. Duas séries no tempo — agrupar é o padrão, empilhar é que exige opção. */
export function BarrasSexo({ dark }: P) {
  const t = chartTheme(dark);
  const anos = [...new Set(dados.respiratoria_sexo.rows.map((r) => String(r[0])))];
  const series = ["Feminino", "Masculino"];
  const valor = (ano: string, sexo: string) =>
    Number(
      dados.respiratoria_sexo.rows.find((r) => String(r[0]) === ano && r[1] === sexo)?.[2] ?? 0,
    );

  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 34, right: 14, bottom: 26, left: 52 },
        xAxis: { ...eixoCategoria(t), data: anos },
        yAxis: eixoValor(t),
        tooltip: {
          trigger: "axis",
          ...tooltipBase(t),
          axisPointer: { type: "shadow" },
          valueFormatter: (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v)),
        },
        legend: {
          top: 2,
          left: 48,
          itemWidth: 9,
          itemHeight: 9,
          textStyle: textoBase(t),
          data: series,
        },
        series: series.map((s, i) => ({
          name: s,
          type: "bar",
          barGap: "8%",
          data: anos.map((a) => valor(a, s)),
          itemStyle: { color: t.serie[i], borderRadius: [4, 4, 0, 0] },
        })),
      }}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Casos que estressam a biblioteca de formas diferentes.
   ──────────────────────────────────────────────────────────────────────── */

/** 5. Alta cardinalidade — 27 UFs. Onde os rótulos do eixo começam a colidir. */
export function BarrasUF({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.internacoes_por_uf.rows.map(([uf, v]) => ({ uf: String(uf), v: Number(v) }));
  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 12, right: 14, bottom: 30, left: 52 },
        xAxis: {
          ...eixoCategoria(t),
          data: d.map((r) => r.uf),
          axisLabel: { ...textoBase(t), fontSize: 9.5, interval: 0 },
        },
        yAxis: eixoValor(t),
        tooltip: {
          trigger: "axis",
          ...tooltipBase(t),
          axisPointer: { type: "shadow" },
          valueFormatter: (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v)),
        },
        series: [
          {
            type: "bar",
            data: d.map((r) => r.v),
            itemStyle: { color: t.serie[0], borderRadius: [3, 3, 0, 0] },
          },
        ],
      }}
    />
  );
}

/** 6. Distribuição — barras encostadas, porque a variável é contínua. */
export function HistogramaIdade({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.distribuicao_idade.rows.map(([ini, v]) => ({
    faixa: `${ini}-${Number(ini) + 4}`,
    v: Number(v),
  }));
  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 12, right: 14, bottom: 30, left: 52 },
        xAxis: {
          ...eixoCategoria(t),
          data: d.map((r) => r.faixa),
          axisLabel: { ...textoBase(t), fontSize: 9.5, interval: 1 },
        },
        yAxis: eixoValor(t),
        tooltip: {
          trigger: "axis",
          ...tooltipBase(t),
          axisPointer: { type: "shadow" },
          valueFormatter: (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v)),
        },
        series: [
          {
            type: "bar",
            data: d.map((r) => r.v),
            // Histograma não tem folga entre barras: o eixo é contínuo.
            barCategoryGap: "0%",
            itemStyle: { color: t.serie[0], borderColor: t.surface, borderWidth: 1 },
          },
        ],
      }}
    />
  );
}

/** 7. Matriz mês × ano — o ECharts tem heatmap como tipo de série. */
export function HeatmapSazonalidade({ dark }: P) {
  const t = chartTheme(dark);
  const linhas = dados.sazonalidade_mes_ano.rows;
  const anos = [...new Set(linhas.map((r) => String(r[0])))];
  const max = Math.max(...linhas.map((r) => Number(r[2])));
  const min = Math.min(...linhas.map((r) => Number(r[2])));
  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 10, right: 14, bottom: 26, left: 38 },
        xAxis: {
          ...eixoCategoria(t),
          data: anos,
          splitArea: { show: true },
          axisLabel: { ...textoBase(t), fontSize: 9.5, interval: 1 },
        },
        yAxis: { ...eixoCategoria(t), data: [...MESES], axisLabel: { ...textoBase(t), fontSize: 9.5 } },
        tooltip: {
          ...tooltipBase(t),
          formatter: (p: { data: [number, number, number] }) =>
            `${MESES[p.data[1]]} de ${anos[p.data[0]]}<br/><b>${nfBR.format(p.data[2])}</b> internações`,
        },
        visualMap: {
          min,
          max,
          calculable: false,
          show: false,
          inRange: { color: [...t.sequencial] },
        },
        series: [
          {
            type: "heatmap",
            data: linhas.map((r) => [anos.indexOf(String(r[0])), Number(r[1]) - 1, Number(r[2])]),
            itemStyle: { borderColor: t.surface, borderWidth: 1 },
          },
        ],
      }}
    />
  );
}

/** 8. Cinco séries no tempo — o limite prático da paleta categórica. */
export function LinhasRegiao({ dark }: P) {
  const t = chartTheme(dark);
  const linhas = dados.evolucao_por_regiao.rows;
  const anos = [...new Set(linhas.map((r) => String(r[0])))];
  const regioes = [...new Set(linhas.map((r) => String(r[1])))];
  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 34, right: 14, bottom: 26, left: 52 },
        xAxis: { ...eixoCategoria(t), data: anos, boundaryGap: false },
        yAxis: eixoValor(t),
        tooltip: {
          trigger: "axis",
          ...tooltipBase(t),
          axisPointer: { type: "line", lineStyle: { color: t.grid } },
          valueFormatter: (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v)),
        },
        legend: { top: 2, left: 48, itemWidth: 9, itemHeight: 9, textStyle: textoBase(t) },
        series: regioes.map((r, i) => ({
          name: r,
          type: "line",
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: t.serie[i], width: 2 },
          itemStyle: { color: t.serie[i] },
          data: anos.map(
            (a) => linhas.find((l) => String(l[0]) === a && String(l[1]) === r)?.[2] ?? null,
          ),
        })),
      }}
    />
  );
}

/**
 * 9. Correlação — custo médio × permanência média por UF.
 * O tamanho do ponto é o número de internações, e é isso que revela a
 * armadilha: SP aparece com o maior custo médio, mas sobre 88.884 linhas.
 */
export function DispersaoCustoPermanencia({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.custo_x_permanencia_uf.rows.map(([uf, perm, custo, n]) => ({
    uf: String(uf),
    perm: Number(perm),
    custo: Number(custo),
    n: Number(n),
  }));
  const maxN = Math.max(...d.map((r) => r.n));
  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 12, right: 18, bottom: 34, left: 56 },
        xAxis: {
          ...eixoValor(t),
          name: "dias",
          nameLocation: "middle",
          nameGap: 20,
          nameTextStyle: textoBase(t),
          axisLabel: { ...textoBase(t), formatter: (v: number) => `${String(v).replace(".", ",")} d` },
          scale: true,
        },
        yAxis: {
          ...eixoValor(t),
          // `abreviar` colapsava 1.800, 2.100 e 2.400 em três ticks "R$ 2 mil".
          // Para dinheiro nesta faixa o valor cheio é o único legível.
          axisLabel: { ...textoBase(t), formatter: (v: number) => `R$ ${nfBR.format(v)}` },
          scale: true,
        },
        tooltip: {
          ...tooltipBase(t),
          formatter: (p: { data: [number, number, number, string] }) =>
            `<b>${p.data[3]}</b><br/>${String(p.data[0]).replace(".", ",")} dias · R$ ${nfBR.format(p.data[1])}<br/>${nfBR.format(p.data[2])} internações`,
        },
        series: [
          {
            type: "scatter",
            data: d.map((r) => [r.perm, r.custo, r.n, r.uf]),
            symbolSize: (v: number[]) => 6 + Math.sqrt(v[2] / maxN) * 22,
            itemStyle: { color: t.serie[0], opacity: 0.75, borderColor: t.surface, borderWidth: 1 },
            label: {
              show: true,
              position: "top",
              formatter: (p: { data: [number, number, number, string] }) => p.data[3],
              ...textoBase(t),
              fontSize: 9.5,
            },
            labelLayout: { hideOverlap: true },
          },
        ],
      }}
    />
  );
}

/** 10. Composição no tempo — empilhada 100%, porque a pergunta é proporção. */
export function EmpilhadaCarater({ dark }: P) {
  const t = chartTheme(dark);
  const linhas = dados.carater_por_ano.rows;
  const anos = [...new Set(linhas.map((r) => String(r[0])))];
  const tipos = ["Urgência", "Eletivo", "Acidente/outros"];
  const totalAno = (a: string) =>
    linhas.filter((l) => String(l[0]) === a).reduce((s, l) => s + Number(l[2]), 0);
  const pct = (a: string, tp: string) => {
    const v = Number(linhas.find((l) => String(l[0]) === a && String(l[1]) === tp)?.[2] ?? 0);
    return +((v / totalAno(a)) * 100).toFixed(2);
  };
  return (
    <Grafico
      deps={[dark]}
      option={{
        grid: { top: 34, right: 14, bottom: 26, left: 44 },
        xAxis: { ...eixoCategoria(t), data: anos, axisLabel: { ...textoBase(t), interval: 1 } },
        yAxis: {
          ...eixoValor(t),
          max: 100,
          axisLabel: { ...textoBase(t), formatter: (v: number) => `${v}%` },
        },
        tooltip: {
          trigger: "axis",
          ...tooltipBase(t),
          axisPointer: { type: "shadow" },
          valueFormatter: (v: unknown) =>
            typeof v === "number" ? `${v.toFixed(1).replace(".", ",")}%` : String(v),
        },
        legend: { top: 2, left: 40, itemWidth: 9, itemHeight: 9, textStyle: textoBase(t) },
        series: tipos.map((tp, i) => ({
          name: tp,
          type: "bar",
          stack: "total",
          data: anos.map((a) => pct(a, tp)),
          // 2px de fundo entre segmentos, como manda o guia.
          itemStyle: { color: t.serie[i], borderColor: t.surface, borderWidth: 1 },
        })),
      }}
    />
  );
}
