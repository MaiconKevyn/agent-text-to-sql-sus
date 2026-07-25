import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Número com separador de milhar em pt-BR. */
export const nf = new Intl.NumberFormat("pt-BR");

/**
 * Colunas cujo número é um IDENTIFICADOR, não uma quantidade. Separador de
 * milhar aqui vira erro de leitura: o código IBGE 330455 não é "330.455".
 */
const RE_IDENTIFICADOR =
  /^(ano|year|mes|month|cid|cnes|cep|n_aih|aih|proc_rea|codigo|cod|id)(_|$)|(_|^)(codigo|cod|id|cnes|cid|ano)(_|$)/i;

export function isIdentifierColumn(nome: string): boolean {
  return RE_IDENTIFICADOR.test(nome.trim());
}

/** Formata células da tabela: número com milhar, nulo como travessão. */
export function formatCell(
  v: string | number | boolean | null,
  column?: string,
): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") {
    if (column && isIdentifierColumn(column)) return String(v);
    // Anos soltos (1900–2099) também não levam separador.
    if (Number.isInteger(v) && v >= 1900 && v <= 2099) return String(v);
    return Number.isInteger(v) ? nf.format(v) : nf.format(Number(v.toFixed(4)));
  }
  return String(v);
}

/** Duração legível: 340 ms, 1,2 s, 1 min 4 s. */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1).replace(".", ",")} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds - m * 60)} s`;
}

/** Ordena valores mistos: números por valor, texto por localidade, nulos por último. */
export function compareValues(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), "pt-BR");
}

/** Monta um CSV com aspas escapadas e BOM, para o Excel abrir em UTF-8. */
export function toCsv(columns: string[], rows: (string | number | boolean | null)[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(";"), ...rows.map((r) => r.map(cell).join(";"))];
  return "﻿" + lines.join("\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Remove acentos e caixa, para busca tolerante no explorador de schema. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export const uid = () => Math.random().toString(36).slice(2, 10);
