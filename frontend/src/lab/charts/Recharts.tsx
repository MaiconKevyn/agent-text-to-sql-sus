import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import dados from "../dados.json";
import { abreviar, chartTheme, nfBR } from "../palette";

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
