import {
  DbtConfig,
  DbtDimension,
  DbtFilter,
  DbtSemanticModel,
  DbtWindow,
  WindowUnit,
} from "./types";

export class Unsupported extends Error {}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const isIdent = (s: string) => IDENT.test(s);
export const sqlExpr = (expr: string) => (isIdent(expr) ? expr : `(${expr})`);
export const qualify = (alias: string, expr: string) =>
  isIdent(expr) ? `${alias}.${expr}` : expr;

export const values = <T>(
  x: Record<string, T> | T[] | null | undefined,
): T[] => (x ? Object.values(x) : []);

export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export function omit(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k)),
  );
}

type WithMeta = {
  config?: DbtConfig | null;
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
};
export function gbMeta(x: WithMeta): Record<string, unknown> {
  const gb = (x.config?.meta ?? x.meta)?.growthbook;
  return isRecord(gb) ? gb : {};
}
// dbt 1.12 writes an empty top-level `tags` beside the real `config.tags`, so read both.
export const tagsOf = (x: WithMeta): string[] => [
  ...new Set([...(x.tags ?? []), ...(x.config?.tags ?? [])]),
];
export const filtersOf = (f?: DbtFilter | null): string[] =>
  (f?.where_filters ?? []).map((w) => w.where_sql_template);

export interface Window {
  value: number;
  unit: WindowUnit;
  note?: string;
}
export function toWindow(w: DbtWindow): Window {
  const days = (n: number): Window => ({ value: w.count * n, unit: "days" });
  const approx = (n: number): Window => ({
    ...days(n),
    note: `window "${w.count} ${w.granularity}" synced as ${w.count * n} days`,
  });
  switch (w.granularity.toLowerCase().replace(/s$/, "")) {
    case "minute":
      return { value: w.count, unit: "minutes" };
    case "hour":
      return { value: w.count, unit: "hours" };
    case "day":
      return days(1);
    case "week":
      return { value: w.count, unit: "weeks" };
    case "month":
      return approx(30);
    case "quarter":
      return approx(91);
    case "year":
      return approx(365);
    default:
      throw new Unsupported(`unknown window granularity "${w.granularity}"`);
  }
}

export function matches(
  patterns: string[] | undefined,
  name: string,
  tags: string[],
): boolean {
  return (patterns ?? []).some((p) => {
    if (p.startsWith("tag:")) return tags.includes(p.slice(4));
    const re = p
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${re}$`).test(name);
  });
}

export const findEntity = (model: DbtSemanticModel, name: string) =>
  (model.entities ?? []).find((e) => e.name === name);
export const findDim = (model: DbtSemanticModel, name: string) =>
  (model.dimensions ?? []).find((d) => d.name === name);
export const ownsEntity = (model: DbtSemanticModel, entity: string) =>
  model.primary_entity === entity ||
  (model.entities ?? []).some((e) => e.name === entity && e.type !== "foreign");
export const dimSql = (d: DbtDimension) => sqlExpr(d.expr ?? d.name);
