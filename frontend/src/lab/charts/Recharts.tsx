import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import dados from "../dados.json";
import { MESES, abreviar, chartTheme, corSequencial, nfBR } from "../palette";

interface P {
  dark: boolean;
}

const eixo = (t: ReturnType<typeof chartTheme>) => ({
  stroke: t.grid,
  tick: { fill: t.inkMuted, fontSize: 11 },
  tickLine: false,
});

const tooltipProps = (t: ReturnType<typeof chartTheme>) => ({
  contentStyle: {
    background: t.surface,
    border: `1px solid ${t.grid}`,
    borderRadius: 8,
    fontSize: 12,
    color: t.ink,
  },
  labelStyle: { color: t.inkMuted },
  // O tipo do formatter do Recharts é `ValueType | undefined`, então a
  // conversão precisa ser defensiva aqui em vez de assumir número.
  formatter: (v: unknown) => (typeof v === "number" ? nfBR.format(v) : String(v ?? "—")),
});

/** 1. Série temporal — mortes por câncer por ano. */
export function LinhaCancer({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.evolucao_cancer.rows.map(([ano, v]) => ({
    ano: Number(ano),
    mortes: Number(v),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={d} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="ano" {...eixo(t)} />
        <YAxis tickFormatter={abreviar} width={56} {...eixo(t)} />
        <Tooltip {...tooltipProps(t)} />
        <Line
          type="monotone"
          dataKey="mortes"
          stroke={t.serie[0]}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 2. Ranking — top 5 municípios. Barra horizontal por causa dos nomes longos. */
export function BarraMunicipios({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_municipios.rows.map(([, nome, uf, v]) => ({
    municipio: `${nome}/${uf}`,
    obitos: Number(v),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={d} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={t.grid} horizontal={false} />
        <XAxis type="number" tickFormatter={abreviar} {...eixo(t)} />
        <YAxis type="category" dataKey="municipio" width={112} {...eixo(t)} />
        <Tooltip {...tooltipProps(t)} cursor={{ fill: t.grid, opacity: 0.4 }} />
        <Bar dataKey="obitos" fill={t.serie[0]} radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 3. Parte-do-todo — top 5 diagnósticos. */
export function PizzaDiagnosticos({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_diagnosticos.rows.map(([, nome, v]) => ({
    nome: String(nome),
    valor: Number(v),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={d}
          dataKey="valor"
          nameKey="nome"
          cx="30%"
          outerRadius={72}
          stroke={t.surface}
          strokeWidth={2}
        >
          {d.map((_, i) => (
            <Cell key={i} fill={t.serie[i % t.serie.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipProps(t)} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          // A legenda do Recharts não trunca sozinha: os nomes de CID têm até
          // 45 caracteres e quebravam em duas linhas por cima do vizinho.
          formatter={(nome: unknown) => {
            const s = String(nome);
            return s.length > 26 ? s.slice(0, 25) + "…" : s;
          }}
          wrapperStyle={{ fontSize: 10.5, color: t.inkMuted, maxWidth: 200, lineHeight: "17px" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** 4. Duas séries no tempo — respiratória por sexo. */
export function BarrasSexo({ dark }: P) {
  const t = chartTheme(dark);
  const anos = [...new Set(dados.respiratoria_sexo.rows.map((r) => Number(r[0])))];
  const d = anos.map((ano) => {
    const linha: Record<string, number | string> = { ano };
    for (const [a, sexo, v] of dados.respiratoria_sexo.rows) {
      if (Number(a) === ano) linha[String(sexo)] = Number(v);
    }
    return linha;
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={d} margin={{ top: 8, right: 16, bottom: 4, left: 0 }} barGap={2}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="ano" {...eixo(t)} />
        <YAxis tickFormatter={abreviar} width={56} {...eixo(t)} />
        <Tooltip {...tooltipProps(t)} cursor={{ fill: t.grid, opacity: 0.4 }} />
        <Legend wrapperStyle={{ fontSize: 11, color: t.inkMuted }} />
        <Bar dataKey="Feminino" fill={t.serie[0]} radius={[4, 4, 0, 0]} />
        <Bar dataKey="Masculino" fill={t.serie[1]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Os mesmos seis casos, para comparar em igualdade de condições.
   ──────────────────────────────────────────────────────────────────────── */

/** 5. Alta cardinalidade — 27 UFs. */
export function BarrasUF({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.internacoes_por_uf.rows.map(([uf, v]) => ({ uf: String(uf), v: Number(v) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={d} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="uf" {...eixo(t)} interval={0} tick={{ fill: t.inkMuted, fontSize: 9.5 }} />
        <YAxis tickFormatter={abreviar} width={56} {...eixo(t)} />
        <Tooltip {...tooltipProps(t)} cursor={{ fill: t.grid, opacity: 0.4 }} />
        <Bar dataKey="v" name="internações" fill={t.serie[0]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 6. Distribuição — `barCategoryGap={0}` para as barras encostarem. */
export function HistogramaIdade({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.distribuicao_idade.rows.map(([ini, v]) => ({
    faixa: `${ini}-${Number(ini) + 4}`,
    v: Number(v),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={d} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} barCategoryGap={0}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis
          dataKey="faixa"
          {...eixo(t)}
          interval={1}
          tick={{ fill: t.inkMuted, fontSize: 9.5 }}
        />
        <YAxis tickFormatter={abreviar} width={56} {...eixo(t)} />
        <Tooltip {...tooltipProps(t)} cursor={{ fill: t.grid, opacity: 0.4 }} />
        <Bar dataKey="v" name="internações" fill={t.serie[0]} stroke={t.surface} strokeWidth={1} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * 7. Matriz mês × ano.
 *
 * O Recharts NÃO tem heatmap. Isto é a imitação: um ScatterChart com eixos
 * de categoria e um `shape` quadrado desenhado à mão, com a escala de cor
 * calculada aqui. São ~45 linhas para o que no ECharts é `type: "heatmap"`,
 * e ainda ficam faltando o tooltip por célula e a legenda de cor.
 */
export function HeatmapSazonalidade({ dark }: P) {
  const t = chartTheme(dark);
  const linhas = dados.sazonalidade_mes_ano.rows;
  const anos = [...new Set(linhas.map((r) => String(r[0])))];
  const vals = linhas.map((r) => Number(r[2]));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const d = linhas.map((r) => ({
    ano: String(r[0]),
    mes: MESES[Number(r[1]) - 1],
    v: Number(r[2]),
  }));

  const Celula = (p: { cx?: number; cy?: number; payload?: { v: number } }) => {
    if (p.cx == null || p.cy == null || !p.payload) return null;
    const larg = 300 / anos.length;
    return (
      <rect
        x={p.cx - larg / 2}
        y={p.cy - 7}
        width={larg - 1}
        height={13}
        fill={corSequencial(t, (p.payload.v - min) / (max - min))}
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <XAxis
          dataKey="ano"
          type="category"
          {...eixo(t)}
          interval={1}
          tick={{ fill: t.inkMuted, fontSize: 9.5 }}
        />
        <YAxis
          dataKey="mes"
          type="category"
          width={38}
          reversed
          {...eixo(t)}
          tick={{ fill: t.inkMuted, fontSize: 9.5 }}
        />
        <Tooltip {...tooltipProps(t)} cursor={false} />
        <Scatter data={d} shape={<Celula />} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** 8. Cinco séries no tempo. */
export function LinhasRegiao({ dark }: P) {
  const t = chartTheme(dark);
  const linhas = dados.evolucao_por_regiao.rows;
  const anos = [...new Set(linhas.map((r) => String(r[0])))];
  const regioes = [...new Set(linhas.map((r) => String(r[1])))];
  const d = anos.map((a) => {
    const l: Record<string, string | number> = { ano: a };
    for (const r of regioes) {
      l[r] = Number(linhas.find((x) => String(x[0]) === a && String(x[1]) === r)?.[2] ?? 0);
    }
    return l;
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={d} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="ano" {...eixo(t)} />
        <YAxis tickFormatter={abreviar} width={56} {...eixo(t)} />
        <Tooltip {...tooltipProps(t)} />
        <Legend wrapperStyle={{ fontSize: 10.5, color: t.inkMuted }} />
        {regioes.map((r, i) => (
          <Line
            key={r}
            type="monotone"
            dataKey={r}
            stroke={t.serie[i]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 9. Correlação — ZAxis dá o tamanho do ponto pelo número de internações. */
export function DispersaoCustoPermanencia({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.custo_x_permanencia_uf.rows.map(([uf, perm, custo, n]) => ({
    uf: String(uf),
    perm: Number(perm),
    custo: Number(custo),
    n: Number(n),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 16, left: 0 }}>
        <CartesianGrid stroke={t.grid} />
        <XAxis
          dataKey="perm"
          type="number"
          // "dataMin - 0.3" fazia o Recharts imprimir 7.319999999999999 no eixo:
          // ele usa o domínio calculado como tick, sem arredondar para número
          // redondo. `domain={[3, 8]}` com ticks explícitos é o conserto.
          domain={[3, 8]}
          ticks={[3, 4, 5, 6, 7, 8]}
          {...eixo(t)}
          tickFormatter={(v: number) => `${v} d`}
        />
        <YAxis
          dataKey="custo"
          type="number"
          width={62}
          domain={[600, 3000]}
          ticks={[600, 1200, 1800, 2400, 3000]}
          {...eixo(t)}
          tickFormatter={(v: number) => `R$ ${nfBR.format(v)}`}
        />
        <ZAxis dataKey="n" range={[30, 520]} />
        <Tooltip
          {...tooltipProps(t)}
          cursor={{ strokeDasharray: "3 3", stroke: t.grid }}
          // Sem `content` próprio o Recharts rotula os eixos "perm"/"custo"
          // e não mostra a UF, que é a única coisa que identifica o ponto.
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof d)[number];
            return (
              <div
                style={{
                  background: t.surface,
                  border: `1px solid ${t.grid}`,
                  borderRadius: 8,
                  padding: "6px 9px",
                  fontSize: 12,
                  color: t.ink,
                }}
              >
                <b>{p.uf}</b>
                <br />
                {String(p.perm).replace(".", ",")} dias · R$ {nfBR.format(p.custo)}
                <br />
                <span style={{ color: t.inkMuted }}>{nfBR.format(p.n)} internações</span>
              </div>
            );
          }}
        />
        <Scatter data={d} fill={t.serie[0]} fillOpacity={0.75} stroke={t.surface}>
          {/* Existe rótulo, mas não existe `hideOverlap`: as UFs do centro do
              gráfico se empilham umas sobre as outras e viram borrão. */}
          <LabelList dataKey="uf" position="top" fontSize={9.5} fill={t.inkMuted} />
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** 10. Composição no tempo — o percentual é calculado antes, não pelo gráfico. */
export function EmpilhadaCarater({ dark }: P) {
  const t = chartTheme(dark);
  const linhas = dados.carater_por_ano.rows;
  const anos = [...new Set(linhas.map((r) => String(r[0])))];
  const tipos = ["Urgência", "Eletivo", "Acidente/outros"];
  const d = anos.map((a) => {
    const doAno = linhas.filter((l) => String(l[0]) === a);
    const total = doAno.reduce((s, l) => s + Number(l[2]), 0);
    const l: Record<string, string | number> = { ano: a };
    for (const tp of tipos) {
      const v = Number(doAno.find((x) => String(x[1]) === tp)?.[2] ?? 0);
      l[tp] = +((v / total) * 100).toFixed(2);
    }
    return l;
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={d} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="ano" {...eixo(t)} interval={1} />
        <YAxis
          width={52}
          domain={[0, 100]}
          ticks={[0, 20, 40, 60, 80, 100]}
          tickFormatter={(v: number) => `${v}%`}
          {...eixo(t)}
        />
        <Tooltip
          {...tooltipProps(t)}
          cursor={{ fill: t.grid, opacity: 0.4 }}
          formatter={(v: unknown) =>
            typeof v === "number" ? `${v.toFixed(1).replace(".", ",")}%` : String(v)
          }
        />
        <Legend wrapperStyle={{ fontSize: 10.5, color: t.inkMuted }} />
        {tipos.map((tp, i) => (
          <Bar key={tp} dataKey={tp} stackId="a" fill={t.serie[i]} stroke={t.surface} strokeWidth={1} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
