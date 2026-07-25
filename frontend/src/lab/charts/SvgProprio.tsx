import dados from "../dados.json";
import { abreviar, chartTheme, nfBR } from "../palette";

interface P {
  dark: boolean;
}

const W = 460;
const H = 220;

/**
 * Ticks em números redondos — o trabalho que uma biblioteca faria por você.
 *
 * A primeira versão parava o laço em `max`, então o último tick podia cair
 * ABAIXO do maior valor: com máximo de 516.837 o topo virava 400.000 e as
 * barras de 2022 eram desenhadas 29% acima da área do gráfico, cortadas pela
 * viewport. As duas ficavam rentes ao topo e pareciam iguais, escondendo uma
 * diferença real de 8% — um gráfico errado, sem erro nenhum no console.
 * O topo tem de ser o múltiplo do passo imediatamente ACIMA do máximo.
 */
function ticksBonitos(max: number, alvo = 4): number[] {
  const bruto = max / alvo;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? mag * 10;
  const topo = Math.ceil(max / passo) * passo;
  const saida: number[] = [];
  for (let v = 0; v <= topo + passo * 1e-6; v += passo) saida.push(v);
  return saida;
}

export function LinhaCancer({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.evolucao_cancer.rows.map(([ano, v]) => ({ ano: Number(ano), v: Number(v) }));
  const m = { top: 12, right: 12, bottom: 24, left: 52 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(...d.map((p) => p.v));
  const ticks = ticksBonitos(max);
  const topo = ticks[ticks.length - 1];
  const x = (i: number) => m.left + (i / (d.length - 1)) * iw;
  const y = (v: number) => m.top + ih - (v / topo) * ih;
  const caminho = d.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");

  return (
    <svg width={W} height={H} role="img" aria-label="Mortes por câncer por ano">
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={m.left} x2={W - m.right} y1={y(tk)} y2={y(tk)} stroke={t.grid} />
          <text x={m.left - 8} y={y(tk) + 3.5} textAnchor="end" fontSize={11} fill={t.inkMuted}>
            {abreviar(tk)}
          </text>
        </g>
      ))}
      {d.map((p, i) =>
        i % 4 === 0 || i === d.length - 1 ? (
          <text
            key={p.ano}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === d.length - 1 ? "end" : "middle"}
            fontSize={11}
            fill={t.inkMuted}
          >
            {p.ano}
          </text>
        ) : null,
      )}
      <path d={caminho} fill="none" stroke={t.serie[0]} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(d.length - 1)} cy={y(d[d.length - 1].v)} r={4} fill={t.serie[0]} />
      <text
        x={x(d.length - 1) - 6}
        y={y(d[d.length - 1].v) - 9}
        textAnchor="end"
        fontSize={11}
        fontWeight={600}
        fill={t.ink}
      >
        {abreviar(d[d.length - 1].v)}
      </text>
    </svg>
  );
}

export function BarraMunicipios({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_municipios.rows.map(([, nome, uf, v]) => ({
    rotulo: `${nome}/${uf}`,
    v: Number(v),
  }));
  const m = { top: 8, right: 52, bottom: 22, left: 118 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(...d.map((p) => p.v));
  const ticks = ticksBonitos(max, 3);
  const topo = ticks[ticks.length - 1];
  const alturaFaixa = ih / d.length;
  const altura = Math.min(20, alturaFaixa - 8);

  return (
    <svg width={W} height={H} role="img" aria-label="Cinco municípios com mais óbitos de homens">
      {ticks.map((tk) => (
        <g key={tk}>
          <line
            x1={m.left + (tk / topo) * iw}
            x2={m.left + (tk / topo) * iw}
            y1={m.top}
            y2={m.top + ih}
            stroke={t.grid}
          />
          <text
            x={m.left + (tk / topo) * iw}
            y={H - 6}
            textAnchor="middle"
            fontSize={11}
            fill={t.inkMuted}
          >
            {abreviar(tk)}
          </text>
        </g>
      ))}
      {d.map((p, i) => {
        const cy = m.top + i * alturaFaixa + alturaFaixa / 2;
        const larg = (p.v / topo) * iw;
        return (
          <g key={p.rotulo}>
            <text x={m.left - 8} y={cy + 3.5} textAnchor="end" fontSize={11} fill={t.inkMuted}>
              {p.rotulo}
            </text>
            <rect
              x={m.left}
              y={cy - altura / 2}
              width={Math.max(2, larg)}
              height={altura}
              rx={4}
              fill={t.serie[0]}
            />
            <text x={m.left + larg + 7} y={cy + 3.5} fontSize={11} fill={t.inkMuted}>
              {abreviar(p.v)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PizzaDiagnosticos({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_diagnosticos.rows.map(([, nome, v]) => ({
    nome: String(nome),
    v: Number(v),
  }));
  const total = d.reduce((s, p) => s + p.v, 0);
  const R = 76;
  const cx = 92;
  const cy = H / 2;
  let ang = -Math.PI / 2;

  return (
    <svg width={W} height={H} role="img" aria-label="Cinco principais diagnósticos">
      {d.map((p, i) => {
        const fatia = (p.v / total) * Math.PI * 2;
        const a0 = ang;
        const a1 = ang + fatia;
        ang = a1;
        const grande = fatia > Math.PI ? 1 : 0;
        const caminho = [
          `M${cx},${cy}`,
          `L${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)}`,
          `A${R},${R} 0 ${grande} 1 ${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)}`,
          "Z",
        ].join(" ");
        return (
          <path key={i} d={caminho} fill={t.serie[i]} stroke={t.surface} strokeWidth={2} />
        );
      })}
      {d.map((p, i) => (
        <g key={p.nome} transform={`translate(190, ${34 + i * 32})`}>
          <rect width={9} height={9} rx={2} y={-7} fill={t.serie[i]} />
          <text x={15} y={0} fontSize={10.5} fill={t.inkMuted}>
            {p.nome.length > 30 ? p.nome.slice(0, 29) + "…" : p.nome}
          </text>
          <text x={15} y={13} fontSize={10} fill={t.inkSubtle}>
            {nfBR.format(p.v)} · {((p.v / total) * 100).toFixed(1).replace(".", ",")}%
          </text>
        </g>
      ))}
    </svg>
  );
}

export function BarrasSexo({ dark }: P) {
  const t = chartTheme(dark);
  const anos = [...new Set(dados.respiratoria_sexo.rows.map((r) => Number(r[0])))];
  const series = ["Feminino", "Masculino"];
  const valor = (ano: number, sexo: string) =>
    Number(dados.respiratoria_sexo.rows.find((r) => Number(r[0]) === ano && r[1] === sexo)?.[2] ?? 0);

  const m = { top: 26, right: 12, bottom: 24, left: 52 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(...anos.flatMap((a) => series.map((s) => valor(a, s))));
  const ticks = ticksBonitos(max);
  const topo = ticks[ticks.length - 1];
  const grupo = iw / anos.length;
  const larg = Math.min(34, (grupo - 16) / series.length);

  return (
    <svg width={W} height={H} role="img" aria-label="Internações respiratórias por sexo e ano">
      {series.map((s, i) => (
        <g key={s} transform={`translate(${m.left + i * 108}, 10)`}>
          <rect width={9} height={9} rx={2} y={-7} fill={t.serie[i]} />
          <text x={14} y={1} fontSize={11} fill={t.inkMuted}>
            {s}
          </text>
        </g>
      ))}
      {ticks.map((tk) => {
        const y = m.top + ih - (tk / topo) * ih;
        return (
          <g key={tk}>
            <line x1={m.left} x2={W - m.right} y1={y} y2={y} stroke={t.grid} />
            <text x={m.left - 8} y={y + 3.5} textAnchor="end" fontSize={11} fill={t.inkMuted}>
              {abreviar(tk)}
            </text>
          </g>
        );
      })}
      {anos.map((ano, gi) => (
        <g key={ano}>
          {series.map((s, si) => {
            const v = valor(ano, s);
            const h = (v / topo) * ih;
            // 2px de folga entre barras adjacentes, como manda o guia.
            const x = m.left + gi * grupo + (grupo - larg * series.length - 2) / 2 + si * (larg + 2);
            return (
              <rect
                key={s}
                x={x}
                y={m.top + ih - h}
                width={larg}
                height={Math.max(1, h)}
                rx={4}
                fill={t.serie[si]}
              />
            );
          })}
          <text
            x={m.left + gi * grupo + grupo / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={11}
            fill={t.inkMuted}
          >
            {ano}
          </text>
        </g>
      ))}
    </svg>
  );
}
