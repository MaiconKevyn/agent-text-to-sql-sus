import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useIsDark } from "@/hooks/useTheme";
import { abreviar, chartTheme, nfBR } from "@/lib/chartTheme";
import type { ChartSpec, QueryResult } from "@/lib/types";

// Registro explícito: importar de "echarts" traria ~370 KB gzip em vez de ~205.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  LabelLayout,
  SVGRenderer,
]);

type Celula = string | number | boolean | null;

interface Props {
  spec: ChartSpec;
  result: QueryResult;
  /**
   * Ocupa toda a altura disponível em vez dos 260px fixos.
   *
   * É o que o painel precisa: lá o bloco tem altura ajustável, e um gráfico de
   * altura fixa dentro dele ou sobra ou deixa um vazio. O ResizeObserver que já
   * existe aqui cuida do resto — o ECharts é avisado sozinho.
   */
  preencher?: boolean;
}

/**
 * O agente declara a forma e as colunas; a série é montada AQUI, a partir das
 * linhas que o DuckDB devolveu. É por isso que o gráfico não pode conter um
 * número que a consulta não retornou — o modelo nunca escreve um ponto.
 */
export function ResultChart({ spec, result, preencher = false }: Props) {
  const dark = useIsDark();
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts>();

  const option = useMemo(() => montaOpcao(spec, result, dark), [spec, result, dark]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Um `init` sobre um dom que já tem instância devolve a antiga e deixa a
    // nova sem conteúdo — e o StrictMode monta, desmonta e remonta, então em
    // desenvolvimento isso acontece sempre. O sintoma não é gráfico sumido: é
    // o ResizeObserver ficar preso à instância errada, e o gráfico parar de
    // acompanhar o tamanho do bloco.
    echarts.getInstanceByDom(el)?.dispose();
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
    // `true` descarta a opção anterior; sem isso, trocar de tema deixa séries
    // antigas grudadas no gráfico.
    if (option) inst.current?.setOption(option, true);
  }, [option]);

  // `montaOpcao` devolve null quando a forma não casa com o resultado. Melhor
  // não mostrar gráfico nenhum do que mostrar um gráfico errado.
  if (!option) return null;

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border border-line bg-surface",
        preencher && "flex h-full min-h-0 flex-col",
      )}
    >
      <figcaption className="flex items-baseline justify-between gap-2 border-b border-line px-3.5 py-2">
        <span className="truncate text-[12.5px] font-medium text-ink">
          {spec.title || "Gráfico do resultado"}
        </span>
        <span className="shrink-0 text-[11px] text-ink-subtle">
          {result.nRows.toLocaleString("pt-BR")} linha
          {result.nRows === 1 ? "" : "s"}
        </span>
      </figcaption>
      <div
        ref={host}
        className={cn("w-full p-1", preencher ? "min-h-0 flex-1" : "h-[260px]")}
        role="img"
        aria-label={spec.title}
      />
      {spec.reason && (
        <p className="border-t border-line px-3.5 py-1.5 text-[11.5px] text-ink-subtle">
          {spec.reason}
        </p>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------------- */

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function montaOpcao(spec: ChartSpec, res: QueryResult, dark: boolean) {
  const t = chartTheme(dark);
  const ix = res.columns.indexOf(spec.x);
  const iy = res.columns.indexOf(spec.y);
  if (ix < 0 || iy < 0) return null;
  const is = spec.series ? res.columns.indexOf(spec.series) : -1;

  const texto = { color: t.inkMuted, fontSize: 11, fontFamily: "inherit" };
  const tooltip = {
    backgroundColor: t.surface,
    borderColor: t.line,
    borderWidth: 1,
    textStyle: { color: t.ink, fontSize: 12 },
    extraCssText: "border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14)",
  };
  const num = (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v ?? "—"));
  const eixoValor = {
    type: "value" as const,
    axisLabel: { ...texto, formatter: abreviar },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: t.line } },
  };
  const eixoCat = {
    type: "category" as const,
    axisLabel: texto,
    axisLine: { lineStyle: { color: t.line } },
    axisTick: { show: false },
  };

  const rotulo = (v: Celula) => String(v ?? "—");
  const valor = (v: Celula) => Number(v ?? 0);
  const categorias = [...new Set(res.rows.map((r) => rotulo(r[ix])))];

  /** Uma série por valor distinto da coluna `series`, alinhada às categorias. */
  const seriesMultiplas = () => {
    const nomes = [...new Set(res.rows.map((r) => rotulo(r[is])))];
    return nomes.map((nome, i) => ({
      nome,
      cor: t.serie[i % t.serie.length],
      dados: categorias.map((c) => {
        const linha = res.rows.find((r) => rotulo(r[ix]) === c && rotulo(r[is]) === nome);
        return linha ? valor(linha[iy]) : null;
      }),
    }));
  };

  const legenda = (nomes: string[]) => ({
    top: 2,
    left: 46,
    itemWidth: 9,
    itemHeight: 9,
    textStyle: texto,
    data: nomes,
  });

  switch (spec.kind) {
    case "linha": {
      const s = is >= 0 ? seriesMultiplas() : null;
      return {
        grid: { top: s ? 34 : 14, right: 16, bottom: 26, left: 58 },
        xAxis: { ...eixoCat, data: categorias, boundaryGap: false },
        yAxis: eixoValor,
        tooltip: {
          trigger: "axis",
          ...tooltip,
          axisPointer: { type: "line", lineStyle: { color: t.line } },
          valueFormatter: num,
        },
        ...(s ? { legend: legenda(s.map((x) => x.nome)) } : {}),
        series: (s ?? [{ nome: spec.y, cor: t.serie[0], dados: res.rows.map((r) => valor(r[iy])) }]).map(
          (x) => ({
            name: x.nome,
            type: "line",
            data: x.dados,
            showSymbol: categorias.length <= 12,
            symbolSize: 6,
            smooth: 0.2,
            lineStyle: { color: x.cor, width: 2 },
            itemStyle: { color: x.cor },
            connectNulls: false,
          }),
        ),
      };
    }

    case "barra":
    case "empilhada_100": {
      const empilha = spec.kind === "empilhada_100";
      const s = is >= 0 ? seriesMultiplas() : null;
      // Em 100% o valor plotado é a fração da categoria, não o absoluto.
      const totais = empilha
        ? categorias.map((_, i) => (s ?? []).reduce((acc, x) => acc + (x.dados[i] ?? 0), 0))
        : [];
      return {
        grid: { top: s ? 34 : 14, right: 16, bottom: 26, left: empilha ? 50 : 58 },
        xAxis: {
          ...eixoCat,
          data: categorias,
          axisLabel: { ...texto, interval: categorias.length > 14 ? 1 : 0, fontSize: categorias.length > 10 ? 9.5 : 11 },
        },
        yAxis: empilha
          ? { ...eixoValor, max: 100, axisLabel: { ...texto, formatter: (v: number) => `${v}%` } }
          : eixoValor,
        tooltip: {
          trigger: "axis",
          ...tooltip,
          axisPointer: { type: "shadow" },
          valueFormatter: empilha
            ? (v: unknown) => (typeof v === "number" ? `${v.toFixed(1).replace(".", ",")}%` : String(v))
            : num,
        },
        ...(s ? { legend: legenda(s.map((x) => x.nome)) } : {}),
        series: (s ?? [{ nome: spec.y, cor: t.serie[0], dados: res.rows.map((r) => valor(r[iy])) }]).map(
          (x) => ({
            name: x.nome,
            type: "bar",
            stack: empilha ? "total" : undefined,
            data: empilha
              ? x.dados.map((v, i) => (totais[i] ? +(((v ?? 0) / totais[i]) * 100).toFixed(2) : 0))
              : x.dados,
            barMaxWidth: 42,
            // 1px de fundo entre segmentos empilhados, como manda o guia.
            itemStyle: empilha
              ? { color: x.cor, borderColor: t.surface, borderWidth: 1 }
              : { color: x.cor, borderRadius: [4, 4, 0, 0] },
          }),
        ),
      };
    }

    case "barra_horizontal": {
      // Ranking lê de cima para baixo; o eixo de categoria do ECharts sobe.
      const rotulos = res.rows.map((r) => rotulo(r[ix])).reverse();
      const vals = res.rows.map((r) => valor(r[iy])).reverse();
      const maiorRotulo = Math.max(...rotulos.map((r) => r.length));
      return {
        grid: {
          top: 10,
          right: 56,
          bottom: 24,
          left: 14,
          containLabel: true,
        },
        xAxis: eixoValor,
        yAxis: {
          ...eixoCat,
          data: rotulos,
          axisLabel: {
            ...texto,
            fontSize: rotulos.length > 12 ? 9.5 : 11,
            width: Math.min(150, maiorRotulo * 6.5),
            overflow: "truncate",
          },
        },
        tooltip: { trigger: "item", ...tooltip, valueFormatter: num },
        series: [
          {
            type: "bar",
            data: vals,
            barMaxWidth: 22,
            itemStyle: { color: t.serie[0], borderRadius: [0, 4, 4, 0] },
            label: {
              show: rotulos.length <= 15,
              position: "right",
              formatter: (p: { value: number }) => abreviar(p.value),
              ...texto,
            },
          },
        ],
      };
    }

    case "pizza": {
      const dados = res.rows.map((r, i) => ({
        name: rotulo(r[ix]),
        value: valor(r[iy]),
        itemStyle: { color: t.serie[i % t.serie.length], borderColor: t.surface, borderWidth: 2 },
      }));
      const total = dados.reduce((s, r) => s + r.value, 0);
      return {
        tooltip: {
          trigger: "item",
          ...tooltip,
          formatter: (p: { name: string; value: number; percent: number }) =>
            `${p.name}<br/><b>${nfBR.format(p.value)}</b> · ${String(p.percent).replace(".", ",")}%`,
        },
        legend: {
          type: "scroll",
          orient: "vertical",
          right: 6,
          top: "middle",
          itemWidth: 9,
          itemHeight: 9,
          itemGap: 10,
          textStyle: { ...texto, fontSize: 10.5 },
          // Truncar aqui e não em `overflow`: o corte por largura comeria o
          // percentual junto com o nome, e o percentual é o dado.
          formatter: (nome: string) => {
            const r = dados.find((x) => x.name === nome);
            if (!r) return nome;
            const curto = nome.length > 22 ? `${nome.slice(0, 21)}…` : nome;
            return `${curto}  ${((r.value / total) * 100).toFixed(1).replace(".", ",")}%`;
          },
        },
        series: [
          {
            type: "pie",
            radius: ["40%", "70%"],
            center: ["28%", "50%"],
            data: dados,
            label: { show: false },
            emphasis: { scale: true, scaleSize: 4 },
          },
        ],
      };
    }

    case "dispersao": {
      // O rótulo do ponto sai da 1ª coluna que não seja um dos dois eixos.
      const ir = res.columns.findIndex((_, i) => i !== ix && i !== iy);
      const dados = res.rows.map((r) => [
        valor(r[ix]),
        valor(r[iy]),
        ir >= 0 ? rotulo(r[ir]) : "",
      ]);
      return {
        grid: { top: 14, right: 20, bottom: 30, left: 62 },
        xAxis: { ...eixoValor, scale: true, axisLabel: { ...texto, formatter: abreviar } },
        yAxis: { ...eixoValor, scale: true },
        tooltip: {
          ...tooltip,
          formatter: (p: { data: [number, number, string] }) =>
            `${p.data[2] ? `<b>${p.data[2]}</b><br/>` : ""}${spec.x}: ${nfBR.format(p.data[0])}<br/>${spec.y}: ${nfBR.format(p.data[1])}`,
        },
        series: [
          {
            type: "scatter",
            data: dados,
            symbolSize: 12,
            itemStyle: { color: t.serie[0], opacity: 0.75, borderColor: t.surface, borderWidth: 1 },
            label: {
              show: dados.length <= 40 && ir >= 0,
              position: "top",
              formatter: (p: { data: [number, number, string] }) => p.data[2],
              ...texto,
              fontSize: 9.5,
            },
            // Sem isto os rótulos do miolo se empilham e viram borrão.
            labelLayout: { hideOverlap: true },
          },
        ],
      };
    }

    case "heatmap": {
      if (is < 0) return null;
      const linhasCat = [...new Set(res.rows.map((r) => rotulo(r[is])))];
      // Mês numérico vira nome; qualquer outra categoria fica como está.
      const ehMes = linhasCat.length <= 12 && linhasCat.every((v) => /^([1-9]|1[0-2])$/.test(v));
      const rotuloLinha = (v: string) => (ehMes ? MESES[Number(v) - 1] : v);
      const vals = res.rows.map((r) => valor(r[iy]));
      return {
        grid: { top: 10, right: 16, bottom: 26, left: 46 },
        xAxis: {
          ...eixoCat,
          data: categorias,
          splitArea: { show: true },
          axisLabel: { ...texto, fontSize: 9.5, interval: categorias.length > 12 ? 1 : 0 },
        },
        yAxis: {
          ...eixoCat,
          data: linhasCat.map(rotuloLinha),
          axisLabel: { ...texto, fontSize: 9.5 },
        },
        tooltip: {
          ...tooltip,
          formatter: (p: { data: [number, number, number] }) =>
            `${rotuloLinha(linhasCat[p.data[1]])} · ${categorias[p.data[0]]}<br/><b>${nfBR.format(p.data[2])}</b>`,
        },
        visualMap: {
          min: Math.min(...vals),
          max: Math.max(...vals),
          show: false,
          inRange: { color: [...t.sequencial] },
        },
        series: [
          {
            type: "heatmap",
            data: res.rows.map((r) => [
              categorias.indexOf(rotulo(r[ix])),
              linhasCat.indexOf(rotulo(r[is])),
              valor(r[iy]),
            ]),
            itemStyle: { borderColor: t.surface, borderWidth: 1 },
          },
        ],
      };
    }

    default:
      return null;
  }
}
