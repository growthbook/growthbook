import { RowFilter, RowFilterOperator } from "./types";

type Literal = { kind: "string" | "number" | "boolean"; value: string };
function literal(raw: string): Literal | null {
  if (/^'(?:[^']|'')*'$/.test(raw)) {
    return { kind: "string", value: raw.slice(1, -1).replace(/''/g, "'") };
  }
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(raw)) return { kind: "number", value: raw };
  if (/^(true|false)$/i.test(raw)) {
    return { kind: "boolean", value: raw.toLowerCase() };
  }
  return null;
}

const COMPARISON = /^\s*([A-Za-z_]\w*)\s*(<=|>=|<>|!=|=|<|>)\s*(.+?)\s*$/;
const IN_LIST = /^\s*([A-Za-z_]\w*)\s+(not\s+)?in\s*\(\s*(.+?)\s*\)\s*$/i;
const NULL_CHECK = /^\s*([A-Za-z_]\w*)\s+is\s+(not\s+)?null\s*$/i;
const DATE_LITERAL = /^\d{4}-\d{2}-\d{2}/;

// Structured row filters are compiled by GrowthBook with no warehouse round
// trip, unlike sql_expr, which is test-run against the warehouse on every
// create. Numeric and boolean literals also need the column typed, or the
// value is quoted as a string. Date literals stay sql_expr: GrowthBook reads
// '2024-01-01' as a whole day on a timestamp column, so `> '2024-01-01'`
// would start on January 2. Anything this doesn't match stays sql_expr too.
export function parseRowFilter(sql: string): {
  filter: RowFilter & { column: string };
  datatype?: "number" | "boolean";
} | null {
  const hint = (lit: Literal) =>
    lit.kind === "string" ? {} : { datatype: lit.kind };
  const isDate = (lit: Literal | null) =>
    lit?.kind === "string" && DATE_LITERAL.test(lit.value);

  const nullCheck = NULL_CHECK.exec(sql);
  if (nullCheck) {
    return {
      filter: {
        operator: nullCheck[2] ? "not_null" : "is_null",
        column: nullCheck[1],
      },
    };
  }

  const inList = IN_LIST.exec(sql);
  if (inList) {
    const lits = inList[3].split(",").map((v) => literal(v.trim()));
    const first = lits[0];
    if (!first || !lits.every((l) => l && l.kind === first.kind)) return null;
    if (first.kind === "boolean" || lits.some(isDate)) return null;
    return {
      filter: {
        operator: inList[2] ? "not_in" : "in",
        column: inList[1],
        values: lits.map((l) => (l as Literal).value),
      },
      ...hint(first),
    };
  }

  const cmp = COMPARISON.exec(sql);
  if (!cmp) return null;
  const [, column, rawOp, rawValue] = cmp;
  const lit = literal(rawValue);
  if (!lit || isDate(lit)) return null;
  const op = rawOp === "<>" ? "!=" : rawOp;
  if (lit.kind === "boolean") {
    if (op !== "=" && op !== "!=") return null;
    const truthy = (lit.value === "true") === (op === "=");
    return {
      filter: { operator: truthy ? "is_true" : "is_false", column },
      datatype: "boolean",
    };
  }
  return {
    filter: { operator: op as RowFilterOperator, column, values: [lit.value] },
    ...hint(lit),
  };
}
