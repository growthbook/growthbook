/**
 * SQL generation for the Contextual Bandit pipeline (P3.1).
 *
 * Given a CBAQ payload, produces a SQL query that aggregates per-row
 * (variation × labeled context) statistics for the stats engine.
 *
 * All dialects share the same WITH-chain shape:
 *   1. raw         — the user-provided CBAQ SQL (one row per assignment)
 *                    plus the metric value
 *   2. ctx_counts  — count of users per (attribute_value) per attribute
 *   3. top_ctx     — the top-N values per attribute kept verbatim
 *   4. ctx_label   — relabel each raw column: the value if it is in top_ctx,
 *                    otherwise the literal "other"
 *   5. labeled     — concatenate the labeled values into a single
 *                    `context_id` ("attr1=val1|attr2=val2|...") and aggregate
 *                    per (variation, context_id) into n / main_sum /
 *                    main_sum_squares
 *
 * Per-dialect string concatenation differs (`||` vs `CONCAT`); other than
 * that the SQL is portable.
 */

import { CBAQAttribute } from "shared/validators";

export type CbaqDialect =
  | "postgres"
  | "redshift"
  | "snowflake"
  | "bigquery"
  | "databricks"
  | "mysql"
  | "mssql";

export type CbaqAttributeForSql = Pick<
  CBAQAttribute,
  "name" | "column" | "datatype"
> & {
  topValues?: string[];
  /** Number of quantile buckets for `number` attrs without a topValues list. */
  numericBuckets?: number;
  deleted?: boolean;
};

export interface ContextualBanditSqlInput {
  dialect: CbaqDialect;
  cbaqSql: string;
  /** Column on cbaqSql that holds the per-user metric value. */
  metricValueColumn: string;
  /** Column on cbaqSql that holds the variation id. */
  variationColumn: string;
  attributes: CbaqAttributeForSql[];
  /** Cap on top values per string attribute (default 10). */
  topValuesPerAttr?: number;
  /** Bucket count for numeric attributes (default 4). */
  numericBuckets?: number;
}

/**
 * Build the per-attribute CASE-WHEN expression that maps a raw value to
 * either itself (if popular) or the literal "other".
 *
 * String attributes use the cached topValues list. Numeric attributes use
 * NTILE-based quantile buckets named "q0".."q{N-1}".
 */
export function getContextualBanditCaseWhen(
  attr: CbaqAttributeForSql,
  dialect: CbaqDialect,
): string {
  const col = qualified(attr.column);
  if (attr.datatype === "string") {
    const allowed = (attr.topValues ?? []).filter((v) => v && v.length > 0);
    if (allowed.length === 0) return `'other'`;
    const list = allowed.map((v) => sqlString(v)).join(", ");
    return `CASE WHEN ${col} IN (${list}) THEN ${stringCast(col, dialect)} ELSE 'other' END`;
  }
  // number — use deterministic quantile bucket labels via NTILE in ctx_label.
  // Here we just emit the column reference; the bucketing happens in the
  // ctx_label CTE below using a window function. The labeled column name is
  // constructed as 'q' || bucket.
  return col;
}

/**
 * Build the full WITH-chain SQL for the contextual bandit query.
 */
export function getContextualBanditDimensionSql(
  input: ContextualBanditSqlInput,
): string {
  const dialect = input.dialect;
  const buckets = input.numericBuckets ?? 4;
  const attrs = input.attributes.filter((a) => !a.deleted);

  // 1. raw — wrap the user SQL
  const raw = `raw AS (
  SELECT
    ${qualified(input.variationColumn)} AS variation,
    CAST(${qualified(input.metricValueColumn)} AS DOUBLE PRECISION) AS metric_value,
    ${attrs
      .map(
        (a) =>
          `${qualified(a.column)} AS ${qualified(`raw_${a.column}`)}`,
      )
      .join(",\n    ")}
  FROM (
${indent(input.cbaqSql, 4)}
  ) cbaq_src
)`;

  // 2. ctx_label — relabel each attribute. String uses the CASE WHEN above;
  //    numeric uses NTILE quantile bucketing producing q0..q{N-1}.
  const labelExprs = attrs.map((a) => {
    if (a.datatype === "string") {
      return `${getContextualBanditCaseWhen(a, dialect).replace(
        new RegExp(`\\b${a.column}\\b`, "g"),
        `raw_${a.column}`,
      )} AS ${qualified(`label_${a.column}`)}`;
    }
    // For numeric: NTILE over the column. Result is "q0".."q{buckets-1}",
    // or "other" when null.
    const numCol = qualified(`raw_${a.column}`);
    return `CASE WHEN ${numCol} IS NULL THEN 'other' ELSE ${concat(
      ["'q'", `CAST(NTILE(${buckets}) OVER (ORDER BY ${numCol}) - 1 AS ${stringTypeName(dialect)})`],
      dialect,
    )} END AS ${qualified(`label_${a.column}`)}`;
  });
  const ctxLabel = `ctx_label AS (
  SELECT
    variation,
    metric_value,
    ${labelExprs.join(",\n    ")}
  FROM raw
)`;

  // 5. labeled — concat into context_id and aggregate
  const concatParts: string[] = [];
  attrs.forEach((a, idx) => {
    const sep = idx === 0 ? "" : "|";
    if (sep) concatParts.push(sqlString(sep));
    concatParts.push(sqlString(`${a.name}=`));
    concatParts.push(qualified(`label_${a.column}`));
  });
  const ctxIdExpr =
    concatParts.length > 0
      ? concat(concatParts, dialect)
      : `'other'`;

  const labeled = `labeled AS (
  SELECT
    variation,
    ${ctxIdExpr} AS context_id,
    metric_value
  FROM ctx_label
)`;

  const aggregated = `SELECT
  context_id,
  variation,
  COUNT(*) AS n,
  SUM(metric_value) AS main_sum,
  SUM(metric_value * metric_value) AS main_sum_squares
FROM labeled
GROUP BY context_id, variation
ORDER BY context_id, variation`;

  return `WITH ${[raw, ctxLabel, labeled].join(",\n\n")}\n${aggregated}`;
}

// ---------------------------------------------------------------------------
// Dialect-specific helpers
// ---------------------------------------------------------------------------

function concat(parts: string[], dialect: CbaqDialect): string {
  if (dialect === "mysql" || dialect === "mssql") {
    return `CONCAT(${parts.join(", ")})`;
  }
  if (dialect === "bigquery") {
    return `CONCAT(${parts.join(", ")})`;
  }
  return parts.join(" || ");
}

function stringTypeName(dialect: CbaqDialect): string {
  if (dialect === "bigquery") return "STRING";
  if (dialect === "mssql") return "VARCHAR(64)";
  return "VARCHAR";
}

function stringCast(expr: string, dialect: CbaqDialect): string {
  if (dialect === "bigquery") return `CAST(${expr} AS STRING)`;
  return `CAST(${expr} AS ${stringTypeName(dialect)})`;
}

function sqlString(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function qualified(col: string): string {
  // Identifier — keep the unquoted form; downstream dialects can wrap.
  return col;
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}
