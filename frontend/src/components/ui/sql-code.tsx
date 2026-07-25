import { Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";

const KEYWORDS =
  "SELECT|FROM|WHERE|GROUP\\s+BY|ORDER\\s+BY|HAVING|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|AS|AND|OR|NOT|IN|IS|NULL|CASE|WHEN|THEN|ELSE|END|WITH|UNION|ALL|DISTINCT|BETWEEN|LIKE|ILIKE|ASC|DESC|OVER|PARTITION|FILTER|CAST|COALESCE|NULLIF|EXISTS|USING|QUALIFY";
const FUNCS =
  "COUNT|SUM|AVG|MIN|MAX|ROUND|MEDIAN|QUANTILE_CONT|ROW_NUMBER|RANK|NTILE|YEAR|MONTH|QUARTER|DAYOFWEEK|DATE_DIFF|DATE_TRUNC|EXTRACT|STRIP_ACCENTS|TRY_CAST|LOWER|UPPER|STRING_AGG|CEIL|FLOOR|ABS";

/** Um passe único de regex, com os grupos na ordem de precedência. */
const TOKENS = new RegExp(
  [
    `(--[^\\n]*)`, // 1 comentário
    `('(?:''|[^'])*')`, // 2 string
    `("(?:""|[^"])*")`, // 3 identificador entre aspas
    `\\b(${KEYWORDS})\\b`, // 4 palavra-chave
    `\\b(${FUNCS})\\s*(?=\\()`, // 5 função
    `\\b(\\d+(?:\\.\\d+)?)\\b`, // 6 número
  ].join("|"),
  "gi",
);

const CLASSES = [
  "text-ink-subtle italic", // comentário
  "text-positive", // string
  "text-ink", // identificador citado
  "font-semibold text-accent", // palavra-chave
  "text-caution", // função
  "text-critical", // número
];

interface SqlCodeProps {
  sql: string;
  className?: string;
}

/**
 * Realce de sintaxe SQL sem dependência externa. Suficiente para leitura —
 * o objetivo é dar estrutura visual, não substituir um parser.
 */
export function SqlCode({ sql, className }: SqlCodeProps) {
  const parts = useMemo(() => {
    const out: { text: string; cls?: string }[] = [];
    let last = 0;
    for (const m of sql.matchAll(TOKENS)) {
      const i = m.index ?? 0;
      if (i > last) out.push({ text: sql.slice(last, i) });
      const grupo = m.slice(1).findIndex((g) => g !== undefined);
      out.push({ text: m[0], cls: CLASSES[grupo] ?? undefined });
      last = i + m[0].length;
    }
    if (last < sql.length) out.push({ text: sql.slice(last) });
    return out;
  }, [sql]);

  return (
    <pre
      className={cn(
        "scroll-thin overflow-x-auto whitespace-pre px-4 py-3",
        "font-mono text-[12.5px] leading-relaxed text-ink-muted",
        className,
      )}
    >
      <code>
        {parts.map((p, i) => (
          <Fragment key={i}>{p.cls ? <span className={p.cls}>{p.text}</span> : p.text}</Fragment>
        ))}
      </code>
    </pre>
  );
}
