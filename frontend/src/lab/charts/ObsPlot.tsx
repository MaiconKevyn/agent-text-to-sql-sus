import * as Plot from "@observablehq/plot";
import { useEffect, useRef, useState } from "react";
import dados from "../dados.json";
import { abreviar, chartTheme, nfBR } from "../palette";

interface P {
  dark: boolean;
}

/**
 * O Plot é imperativo: devolve um nó DOM solto. Este wrapper é todo o custo de
 * usá-lo em React.
 *
 * O `ResizeObserver` não é opcional. O Plot desenha num SVG de largura fixa e
 * aplica `max-width: 100%` — num container de 302px o SVG de 460px é ENCOLHIDO
 * pelo CSS, e a fonte de 11px vira 7px ilegível. Medir e redesenhar na largura
 * real é o que o `ResponsiveContainer` do Recharts faz de graça.
 */
function Figura({
  render,
  deps,
}: {
  render: (largura: number) => SVGSVGElement | HTMLElement;
  deps: unknown[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || largura < 80) return;
    const fig = render(largura);
    el.append(fig);
    return () => fig.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [largura, ...deps]);

  return <div ref={host} className="w-full" />;
}

const base = (t: ReturnType<typeof chartTheme>, largura: number) => ({
  width: largura,
  height: 220,
  marginTop: 12,
  style: { background: "transparent", color: t.inkMuted, fontSize: "11px" },
});

export function LinhaCancer({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.evolucao_cancer.rows.map(([ano, v]) => ({
    ano: Number(ano),
    mortes: Number(v),
  }));
  return (
    <Figura
      deps={[dark]}
      render={(largura) =>
        Plot.plot({
          ...base(t, largura),
          marginLeft: 52,
          x: { label: null, tickFormat: "d", grid: false },
          y: { label: null, tickFormat: abreviar, grid: true, ticks: 5 },
          marks: [
            Plot.ruleY([0], { stroke: t.grid }),
            Plot.line(d, { x: "ano", y: "mortes", stroke: t.serie[0], strokeWidth: 2 }),
            Plot.tip(d, Plot.pointerX({ x: "ano", y: "mortes", title: (r) => `${r.ano}\n${nfBR.format(r.mortes)}` })),
          ],
        })
      }
    />
  );
}

export function BarraMunicipios({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_municipios.rows.map(([, nome, uf, v]) => ({
    municipio: `${nome}/${uf}`,
    obitos: Number(v),
  }));
  return (
    <Figura
      deps={[dark]}
      render={(largura) =>
        Plot.plot({
          ...base(t, largura),
          marginLeft: Math.min(118, 0.3 * 460),
          marginRight: 40,
          x: { label: null, tickFormat: abreviar, grid: true },
          y: { label: null },
          marks: [
            Plot.barX(d, { x: "obitos", y: "municipio", fill: t.serie[0], sort: { y: "-x" }, insetTop: 4, insetBottom: 4 }),
            Plot.text(d, { x: "obitos", y: "municipio", text: (r) => abreviar(r.obitos), dx: 18, fill: t.inkMuted }),
            Plot.ruleX([0], { stroke: t.grid }),
          ],
        })
      }
    />
  );
}

export function PizzaDiagnosticos({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.top5_diagnosticos.rows.map(([, nome, v]) => ({
    nome: String(nome),
    valor: Number(v),
  }));
  // O Plot não tem marca de pizza. A alternativa nativa é a barra empilhada
  // horizontal — que é justamente o que o guia recomenda para parte-do-todo.
  return (
    <Figura
      deps={[dark]}
      render={(largura) =>
        Plot.plot({
          ...base(t, largura),
          height: 130,
          marginLeft: 8,
          marginRight: 8,
          x: { label: null, tickFormat: abreviar },
          color: { domain: d.map((r) => r.nome), range: [...t.serie], legend: true },
          marks: [
            Plot.barX(d, {
              x: "valor",
              fill: "nome",
              insetLeft: 1,
              insetRight: 1,
            }),
          ],
        })
      }
    />
  );
}

export function BarrasSexo({ dark }: P) {
  const t = chartTheme(dark);
  const d = dados.respiratoria_sexo.rows.map(([ano, sexo, v]) => ({
    ano: String(ano),
    sexo: String(sexo),
    internacoes: Number(v),
  }));
  return (
    <Figura
      deps={[dark]}
      render={(largura) =>
        Plot.plot({
          ...base(t, largura),
          marginLeft: 52,
          x: { label: null, axis: null },
          y: { label: null, tickFormat: abreviar, grid: true },
          color: { domain: ["Feminino", "Masculino"], range: [t.serie[0], t.serie[1]], legend: true },
          // Agrupar no Plot exige facetar por `fx` — `fill` sozinho EMPILHA.
          // É a diferença entre "duas séries lado a lado" e "soma das duas",
          // e a versão errada mostrava 600 mil onde o máximo real é 331 mil.
          fx: { label: null },
          marks: [
            Plot.barY(d, { fx: "ano", x: "sexo", y: "internacoes", fill: "sexo", insetLeft: 1, insetRight: 1 }),
            Plot.ruleY([0], { stroke: t.grid }),
          ],
        })
      }
    />
  );
}
