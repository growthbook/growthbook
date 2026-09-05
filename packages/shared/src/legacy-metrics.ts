import { DataSourceType } from "../types/datasource";
import {
  ColumnAggregation,
  ColumnInterface,
  ColumnRef,
  FactMetricInterface,
  FactTableInterface,
  FunnelStep,
  RowFilter,
} from "../types/fact-table";
import { MetricInterface } from "../types/metric";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "./constants";
import { MAX_FUNNEL_FACT_TABLES, MAX_FUNNEL_STEPS } from "./funnels";
import { parseSelectSQL, SqlParseError } from "./sql-parser";

/**
 * Groups legacy metrics into fact tables. A fact table is uniquely defined by
 * the normalized FROM clause plus everything that has to live in the fact
 * table SQL rather than in a per-metric row filter: `sql_expr` filters and the
 * timestamp expression. Metrics also have to agree on the expression for any
 * user id type they share; a metric selecting a subset of another's id types
 * (or disjoint ones) joins the same table, which then carries the union.
 *
 * Legacy SQL contract: the query returns one column per user id type (named
 * after the type), a `timestamp` column and, for non-binomial metrics, a
 * `value` column. The value column is renamed back to its source column when
 * that is a plain column reference, and a constant one (`SELECT 1 AS value`)
 * is dropped in favor of the `$$count` fact metric column. Any other columns
 * are passed through to the fact table.
 * User id types the SQL does not select are dropped: they never worked for
 * that metric anyway. Query-builder metrics are converted to the equivalent
 * SQL first so both formats share one path.
 *
 * WHERE filters shared by every metric in a table are elevated into the fact
 * table SQL, where the warehouse can prune on them. The rest become fact metric
 * row filters, and the source columns they reference are added to the fact
 * table SELECT since row filters apply to the fact table's output columns.
 */

export type ExistingFactTable = Pick<
  FactTableInterface,
  "id" | "sql" | "userIdTypes" | "timestampColumn"
>;

export interface LegacyMetricGroup {
  factTable: Partial<FactTableInterface> &
    Pick<FactTableInterface, "id" | "sql" | "userIdTypes" | "columns">;
  // True when the metrics were matched to one of `existingFactTables`; the
  // factTable is that table and should not be created again.
  existing: boolean;
  metrics: FactMetricInterface[];
}

export interface LegacyMetricConversionResult {
  groups: LegacyMetricGroup[];
  errors: { metricId: string; error: string }[];
}

export interface LegacyMetricConversionOptions {
  datasourceType: DataSourceType;
  generateFactTableId: () => string;
  generateFactMetricId: (metric: MetricInterface) => string;
  // Reused instead of creating a new fact table when the SQL is compatible
  existingFactTables?: ExistingFactTable[];
  // Datasource default schema, prepended to unqualified query-builder tables
  defaultSchema?: string;
  // Identifier types the Data Source defines. Metric id types outside this
  // set can never join to an experiment, so they are ignored.
  userIdTypes?: string[];
}

// A typed WHERE filter together with the SQL it was parsed from
interface TypedFilter {
  rowFilter: RowFilter;
  sql: string;
}

// The parts of a SELECT that decide fact table identity and compatibility
interface SqlShape {
  from: string;
  sqlExprs: string[];
  // alias -> expression
  columns: Map<string, string>;
  filters: TypedFilter[];
  dedupe: boolean;
  tableSuffix?: string;
  // `SUM(x) AS value` style aggregation over a GROUP BY; the fact metric
  // re-aggregates the raw rows instead
  aggregatedValue?: Pick<ColumnRef, "column" | "aggregation">;
  // Other aggregated select aliases (not carried into the fact table)
  aggregatedAliases: string[];
}

interface ParsedLegacyMetric extends SqlShape {
  metric: MetricInterface;
  userIdTypes: string[];
  groupKey: string;
  numerator: Pick<ColumnRef, "column" | "aggregation">;
  metricType: "proportion" | "mean";
  // Alias the metric's value column ends up under, when it is still selected
  valueAlias?: string;
}

interface Group {
  id: string;
  existing: ExistingFactTable | null;
  members: ParsedLegacyMetric[];
  // user id type -> expression, across all members
  userIdExprs: Map<string, string>;
  // alias -> expr for the fact table SELECT
  columns: Map<string, string>;
  // per metric id: original select alias -> fact table alias (after renaming)
  renames: Map<string, Map<string, string>>;
  // filter column expression -> fact table alias
  filterAliases: Map<string, string>;
  // Filters shared by every member, moved into the fact table WHERE
  elevated: Set<string>;
}

// `t.event_name` -> event_name, `"Status"` -> Status; null when the expression
// is not a plain column reference
function bareColumnName(expr: string): string | null {
  const bare = (expr.split(".").pop() || expr).replace(/^["`](.*)["`]$/, "$1");
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(bare) ? bare : null;
}

function isNumericLiteral(expr: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(expr);
}

class ConversionError extends Error {}

function fail(message: string): never {
  throw new ConversionError(message);
}

function isConversionError(e: unknown): e is Error {
  return e instanceof ConversionError || e instanceof SqlParseError;
}

// eventName / valueColumn are static per metric, so bake them in. Runtime
// variables like startDate are left for the query engine.
function interpolateTemplateVariables(metric: MetricInterface): string {
  const vars = metric.templateVariables || {};
  return (metric.sql || "").replace(
    /\{\{\s*(eventName|valueColumn)\s*\}\}/g,
    (match, name: "eventName" | "valueColumn") => vars[name] ?? match,
  );
}

function parseSqlShape(
  sql: string,
  datasourceType: DataSourceType,
  timestampAlias = "timestamp",
  allowAggregates = false,
): SqlShape {
  const parsed = parseSelectSQL(sql, datasourceType, { allowAggregates });
  if (parsed.select[0].expr === "*") fail("SELECT * is not supported");
  const columns = new Map<string, string>();
  const filters: TypedFilter[] = [];
  const aggregatedAliases: string[] = [];
  let aggregatedValue: SqlShape["aggregatedValue"];
  for (const { expr, alias, aggregation } of parsed.select) {
    const key = alias === timestampAlias ? "timestamp" : alias;
    if (columns.has(key)) fail(`Duplicate column alias: ${alias}`);
    if (!aggregation) {
      columns.set(key, expr);
      continue;
    }
    if (key === "timestamp") {
      fail("Aggregated timestamp (first/last event per user) is not supported");
    }
    aggregatedAliases.push(key);
    // Per-user (or per-user-per-day) SUM/COUNT/MAX re-aggregated by the fact
    // metric gives the same total. Aggregated columns other than `value` are
    // never read by a legacy metric, so they are simply not carried over.
    if (key !== "value") continue;
    if (aggregation === "count") {
      aggregatedValue = { column: "$$count" };
      // COUNT(x) skips NULLs where $$count does not
      if (expr !== "*" && !isNumericLiteral(expr)) {
        filters.push({
          rowFilter: { operator: "not_null", column: expr },
          sql: `${expr} IS NOT NULL`,
        });
      }
    } else {
      columns.set("value", expr);
      aggregatedValue = { column: "value", aggregation };
    }
  }
  const sqlExprs: string[] = [];
  (parsed.where || []).forEach((rowFilter, i) => {
    if (rowFilter.operator === "sql_expr") {
      sqlExprs.push(rowFilter.values?.[0] || "");
    } else {
      filters.push({ rowFilter, sql: parsed.whereSql?.[i] || "" });
    }
  });
  return {
    from: parsed.from,
    sqlExprs: sqlExprs.sort(),
    columns,
    filters,
    dedupe: !!parsed.dedupe,
    tableSuffix: parsed.tableSuffix,
    aggregatedAliases,
    ...(aggregatedValue ? { aggregatedValue } : {}),
  };
}

function isBuilderMetric(metric: MetricInterface): boolean {
  return metric.queryFormat === "builder" || !metric.sql;
}

// The deprecated query builder stores table/column/conditions; mirror the SQL
// the legacy query engine generated from them (see metric-cte.ts).
function builderToSql(metric: MetricInterface, defaultSchema = ""): string {
  if (!metric.table) fail("Metric does not use SQL");
  const table =
    defaultSchema && !metric.table.includes(".")
      ? `${defaultSchema}.${metric.table}`
      : metric.table;
  const cols = (metric.userIdTypes || []).map(
    (type) => `${metric.userIdColumns?.[type] || type} AS ${type}`,
  );
  cols.push(`${metric.timestampColumn || "received_at"} AS timestamp`);
  if (metric.type !== "binomial" && metric.column) {
    // Duration metrics could reference the table alias in the expression
    if (/\{alias\}(?!\.)/.test(metric.column)) {
      fail("Unsupported {alias} placeholder in column");
    }
    cols.push(`${metric.column.replace(/\{alias\}\./g, "")} AS value`);
  }
  const where = (metric.conditions || []).map((c) => {
    if (c.operator === "=>") fail("Custom javascript conditions are not SQL");
    return `${c.column} ${c.operator} '${c.value.replace(/'/g, "''")}'`;
  });
  return (
    `SELECT ${cols.join(", ")} FROM ${table}` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "")
  );
}

// Map a legacy custom aggregation to a fact metric numerator. Legacy SQL runs
// the aggregation over each user's `value` rows.
function parseAggregation(
  metric: MetricInterface,
  aggregatedValue?: SqlShape["aggregatedValue"],
): Pick<ColumnRef, "column" | "aggregation"> & {
  metricType: "proportion" | "mean";
} {
  if (metric.type === "binomial") {
    return { column: "$$distinctUsers", metricType: "proportion" };
  }
  if (aggregatedValue) {
    if (metric.aggregation?.trim()) {
      fail("Custom aggregation over already aggregated SQL is not supported");
    }
    return { ...aggregatedValue, metricType: "mean" };
  }
  // The builder ignored custom aggregations: count distinct of the column,
  // row count without one, and MAX for revenue/duration.
  if (isBuilderMetric(metric)) {
    if (metric.type === "count") {
      return metric.column
        ? { column: "value", aggregation: "count distinct", metricType: "mean" }
        : { column: "$$count", metricType: "mean" };
    }
    return { column: "value", aggregation: "max", metricType: "mean" };
  }
  const agg = (metric.aggregation || "").trim();
  if (!agg) return { column: "value", aggregation: "sum", metricType: "mean" };
  // A hardcoded number counts each converting user once
  if (Number(agg) === 1) {
    return { column: "$$distinctUsers", metricType: "proportion" };
  }
  const known: Record<string, ColumnAggregation> = {
    "SUM(VALUE)": "sum",
    "SUM(COALESCE(VALUE,0))": "sum",
    "MAX(VALUE)": "max",
    "MAX(COALESCE(VALUE,0))": "max",
    "COUNT(DISTINCTVALUE)": "count distinct",
    "COUNT(DISTINCT(VALUE))": "count distinct",
  };
  const normalized = agg.toUpperCase().replace(/\s+/g, "");
  if (normalized === "COUNT(VALUE)" || normalized === "COUNT(*)") {
    return { column: "$$count", metricType: "mean" };
  }
  const aggregation = known[normalized];
  if (!aggregation) fail(`Unsupported custom aggregation: ${agg}`);
  return { column: "value", aggregation, metricType: "mean" };
}

function parseLegacyMetric(
  metric: MetricInterface,
  options: LegacyMetricConversionOptions,
): ParsedLegacyMetric {
  const shape = parseSqlShape(
    isBuilderMetric(metric)
      ? builderToSql(metric, options.defaultSchema)
      : interpolateTemplateVariables(metric),
    options.datasourceType,
    "timestamp",
    true,
  );
  let { columns } = shape;

  const configured = (metric.userIdTypes || []).filter(
    (t) => !options.userIdTypes || options.userIdTypes.includes(t),
  );
  if (!configured.length && metric.userIdTypes?.length) {
    fail(
      `None of the metric's identifier types (${metric.userIdTypes.join(", ")}) are defined on the Data Source`,
    );
  }
  const userIdTypes = configured.filter((t) => columns.has(t));
  if (!userIdTypes.length) {
    if (shape.aggregatedAliases.some((a) => configured.includes(a))) {
      fail("Aggregated user id (one row per group) is not supported");
    }
    fail(
      `SQL does not select any user id column (${(metric.userIdTypes || []).join(", ") || "none configured"})`,
    );
  }
  if (!columns.has("timestamp")) fail("SQL does not select a timestamp column");

  const { metricType, ...parsed } = parseAggregation(
    metric,
    shape.aggregatedValue,
  );
  let numerator: Pick<ColumnRef, "column" | "aggregation"> = parsed;
  if (numerator.column === "value" && !columns.has("value")) {
    fail("SQL does not select a value column");
  }

  let valueAlias: string | undefined;
  const valueExpr = columns.get("value");
  if (valueExpr !== undefined) {
    const constant = isNumericLiteral(valueExpr);
    if (
      constant &&
      Number(valueExpr) === 1 &&
      numerator.column === "value" &&
      numerator.aggregation === "sum"
    ) {
      // `SELECT 1 AS value` summed per user is just a row count
      numerator = { column: "$$count" };
    }
    if (constant && numerator.column !== "value") {
      // A constant value column carries no information in a fact table
      columns.delete("value");
    } else {
      // Legacy SQL forced the name `value`; fact tables don't, so restore the
      // source column name when the expression is a plain column reference
      const name = bareColumnName(valueExpr);
      const alias = name && !columns.has(name) ? name : "value";
      valueAlias = alias;
      if (alias !== "value") {
        columns = new Map(
          [...columns].map(([key, expr]) =>
            key === "value" ? [alias, expr] : [key, expr],
          ),
        );
        if (numerator.column === "value") {
          numerator = { ...numerator, column: alias };
        }
      }
    }
  }

  const groupKey = JSON.stringify([
    shape.from,
    shape.sqlExprs,
    columns.get("timestamp"),
  ]);

  return {
    ...shape,
    columns,
    metric,
    userIdTypes,
    groupKey,
    numerator,
    metricType,
    valueAlias,
  };
}

// Register `expr` under `alias` in the group's SELECT, renaming with a numeric
// suffix when the alias is already taken by a different expression.
function addColumn(group: Group, alias: string, expr: string): string {
  let target = alias;
  for (
    let n = 2;
    group.columns.has(target) && group.columns.get(target) !== expr;
    n++
  ) {
    target = `${alias}_${n}`;
  }
  group.columns.set(target, expr);
  return target;
}

function addSelectColumns(group: Group, member: ParsedLegacyMetric) {
  const renames = new Map<string, string>();
  for (const [alias, expr] of member.columns) {
    const target = addColumn(group, alias, expr);
    if (target !== alias) renames.set(alias, target);
  }
  group.renames.set(member.metric.id, renames);
}

// Filters that every member applies move into the fact table WHERE. Whatever
// remains stays a row filter, so its source column must be selected.
function finalizeFilters(group: Group) {
  const [first, ...rest] = group.members;
  group.elevated = new Set(
    first.filters
      .filter((f) => rest.every((m) => m.filters.some((g) => g.sql === f.sql)))
      .map((f) => f.sql),
  );
  for (const member of group.members) {
    for (const { rowFilter, sql } of member.filters) {
      const expr = rowFilter.column;
      if (group.elevated.has(sql) || !expr || group.filterAliases.has(expr)) {
        continue;
      }
      const alias = bareColumnName(expr) ?? "filter_col";
      group.filterAliases.set(expr, addColumn(group, alias, expr));
    }
  }
}

// An existing fact table can host the group when it reads the same rows and
// already exposes every column the group needs under the same alias.
function findExistingFactTable(
  group: Group,
  existing: (SqlShape & { table: ExistingFactTable })[],
): ExistingFactTable | null {
  const first = group.members[0];
  const needsDedupe = group.members.some((m) => m.dedupe);
  const userIdTypes = new Set(group.members.flatMap((m) => m.userIdTypes));
  const match = existing.find(
    (e) =>
      e.from === first.from &&
      JSON.stringify(e.sqlExprs) === JSON.stringify(first.sqlExprs) &&
      // Typed filters in the existing SQL would drop rows the metrics need
      e.filters.length === 0 &&
      (e.dedupe || !needsDedupe) &&
      [...userIdTypes].every((t) => e.table.userIdTypes.includes(t)) &&
      [...group.columns].every(
        ([alias, expr]) => e.columns.get(alias) === expr,
      ),
  );
  return match?.table ?? null;
}

function buildFactTableSql(group: Group): string {
  const { from } = group.members[0];
  const cols = [...group.columns].map(([alias, expr]) =>
    bareColumnName(expr) === alias ? expr : `${expr} AS ${alias}`,
  );
  const where = [
    ...group.elevated,
    ...new Set(group.members.flatMap((m) => m.sqlExprs)),
  ];
  // _TABLE_SUFFIX is a partition-pruning optimization keyed to the experiment
  // date range. In practice every variant is the same range spelled with a
  // different template syntax, sometimes with the GA4 intraday tables added or
  // a disjunct duplicated, so keep the single most permissive clause.
  const suffix = group.members
    .flatMap((m) => m.tableSuffix ?? [])
    .map((clause) => [
      ...new Set(
        clause.split(/\s+OR\s+/).map((d) => d.replace(/^\((.*)\)$/, "$1")),
      ),
    ])
    .sort((a, b) => b.length - a.length)[0];
  if (suffix) {
    where.push(
      suffix.length === 1
        ? suffix[0]
        : suffix.map((d) => `(${d})`).join(" OR "),
    );
  }
  const distinct = group.members.some((m) => m.dedupe) ? "DISTINCT " : "";
  return (
    `SELECT ${distinct}\n  ${cols.join(",\n  ")}\nFROM ${from}` +
    (where.length
      ? `\nWHERE ${where.map((w) => `(${w})`).join("\n  AND ")}`
      : "")
  );
}

// `schema.orders o` -> "orders"; with an elevated `event_name = 'purchase'`
// filter -> "orders - purchase". Subquery FROMs fall back to the metric name.
function buildFactTableName(group: Group): string {
  const { from, metric, filters } = group.members[0];
  const table = from.split(/\s/)[0];
  // Strip identifier quotes first: BigQuery quotes the whole dotted path
  const bare = table.replace(/^["`](.*)["`]$/, "$1");
  let name = table.startsWith("(")
    ? metric.name
    : bare.split(".").pop() || bare;
  const values = filters
    .filter((f) => group.elevated.has(f.sql))
    .flatMap((f) =>
      f.rowFilter.operator === "=" || f.rowFilter.operator === "in"
        ? (f.rowFilter.values ?? [])
        : [],
    );
  if (values.length) name += ` - ${values.join(", ")}`;
  return name;
}

function buildColumns(group: Group, now: Date): ColumnInterface[] {
  const userIdTypes = new Set(group.members.flatMap((m) => m.userIdTypes));
  const valueTypes = new Map<string, MetricInterface["type"]>();
  for (const m of group.members) {
    if (!m.valueAlias) continue;
    const alias = group.renames.get(m.metric.id)?.get(m.valueAlias);
    valueTypes.set(alias ?? m.valueAlias, m.metric.type);
  }
  return [...group.columns.keys()].map((column) => {
    const valueType = valueTypes.get(column);
    return {
      dateCreated: now,
      dateUpdated: now,
      name: column,
      description: "",
      column,
      datatype: userIdTypes.has(column)
        ? "string"
        : column === "timestamp"
          ? "date"
          : valueType
            ? "number"
            : "",
      numberFormat:
        valueType === "revenue"
          ? "currency"
          : valueType === "duration"
            ? "time:seconds"
            : "",
      deleted: false,
    };
  });
}

function buildFactTable(
  group: Group,
  name: string,
  now: Date,
): LegacyMetricGroup["factTable"] {
  const metrics = group.members.map((m) => m.metric);
  const first = metrics[0];
  const projects = metrics.some((m) => !m.projects?.length)
    ? []
    : [...new Set(metrics.flatMap((m) => m.projects || []))];
  return {
    id: group.id,
    organization: first.organization,
    datasource: first.datasource,
    owner: first.owner,
    name,
    description: "",
    projects,
    tags: [...new Set(metrics.flatMap((m) => m.tags || []))],
    userIdTypes: [...new Set(group.members.flatMap((m) => m.userIdTypes))],
    sql: buildFactTableSql(group),
    eventName: "",
    columns: buildColumns(group, now),
    filters: [],
    dateCreated: now,
    dateUpdated: now,
  };
}

type Placed = { member: ParsedLegacyMetric; group: Group };

function buildColumnRef({ member, group }: Placed): ColumnRef {
  const renames = group.renames.get(member.metric.id);
  const column = member.numerator.column.startsWith("$$")
    ? member.numerator.column
    : (renames?.get(member.numerator.column) ?? member.numerator.column);
  return {
    factTableId: group.id,
    column,
    ...(member.numerator.aggregation
      ? { aggregation: member.numerator.aggregation }
      : {}),
    rowFilters: member.filters
      .filter((f) => !group.elevated.has(f.sql))
      .map(({ rowFilter }) => ({
        ...rowFilter,
        ...(rowFilter.column
          ? { column: group.filterAliases.get(rowFilter.column) }
          : {}),
      })),
  };
}

// Legacy metrics chain denominators: metric -> denominator -> its denominator.
// Returns the chain from the outermost (first step) to the immediate one.
function denominatorChain(
  metric: MetricInterface,
  lookup: Map<string, Placed>,
): Placed[] {
  const chain: Placed[] = [];
  let id = metric.denominator;
  while (id) {
    if (chain.length >= MAX_FUNNEL_STEPS) fail("Denominator chain is too long");
    const den = lookup.get(id);
    if (!den) fail(`Denominator metric ${id} could not be converted`);
    chain.unshift(den);
    id = den.member.metric.denominator;
  }
  return chain;
}

// A legacy binomial denominator gates the numerator on prior conversion, with
// each metric's conversion window measured from the previous step. That is a
// sequential funnel.
function buildFunnelStep(placed: Placed): FunnelStep {
  const { windowSettings, name } = placed.member.metric;
  if (windowSettings.type === "lookback") {
    fail("Lookback windows are not supported in funnel steps");
  }
  if (windowSettings.delayValue) {
    fail("Conversion delays are not supported in funnel steps");
  }
  return {
    name,
    factTableId: placed.group.id,
    rowFilters: buildColumnRef(placed).rowFilters ?? [],
    optional: false,
    conversionWindow:
      windowSettings.type === "conversion"
        ? { unit: windowSettings.windowUnit, value: windowSettings.windowValue }
        : null,
  };
}

function buildFactMetric(
  placed: Placed,
  lookup: Map<string, Placed>,
  options: LegacyMetricConversionOptions,
  now: Date,
): FactMetricInterface {
  const { member, group } = placed;
  const { metric } = member;
  const chain = denominatorChain(metric, lookup);

  const base = {
    id: options.generateFactMetricId(metric),
    organization: metric.organization,
    managedBy: metric.managedBy === "api" ? ("api" as const) : ("" as const),
    owner: metric.owner,
    datasource: metric.datasource,
    dateCreated: now,
    dateUpdated: now,
    name: metric.name,
    description: metric.description,
    tags: metric.tags || [],
    projects: metric.projects || [],
    inverse: metric.inverse,
    archived: metric.status === "archived",
    cappingSettings: metric.cappingSettings,
    windowSettings: metric.windowSettings,
    priorSettings: metric.priorSettings,
    maxPercentChange: metric.maxPercentChange ?? DEFAULT_MAX_PERCENT_CHANGE,
    minPercentChange: metric.minPercentChange ?? DEFAULT_MIN_PERCENT_CHANGE,
    minSampleSize: metric.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE,
    ...(metric.targetMDE !== undefined ? { targetMDE: metric.targetMDE } : {}),
    winRisk: metric.winRisk ?? DEFAULT_WIN_RISK_THRESHOLD,
    loseRisk: metric.loseRisk ?? DEFAULT_LOSE_RISK_THRESHOLD,
    regressionAdjustmentOverride: !!metric.regressionAdjustmentOverride,
    regressionAdjustmentEnabled: !!metric.regressionAdjustmentEnabled,
    regressionAdjustmentDays:
      metric.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
    quantileSettings: null,
    // Links back to the legacy metric so old snapshots still render
    replaces: [metric.id],
  };

  const immediate = chain[chain.length - 1];
  if (immediate && immediate.member.metric.type === "binomial") {
    const steps = [...chain, placed];
    const nonBinomial = steps.find((s) => s.member.metric.type !== "binomial");
    if (nonBinomial) {
      fail(
        `Funnel with a non-binomial step (${nonBinomial.member.metric.id}) is not supported`,
      );
    }
    if (new Set(steps.map((s) => s.group.id)).size > MAX_FUNNEL_FACT_TABLES) {
      fail(`Funnels can span at most ${MAX_FUNNEL_FACT_TABLES} fact tables`);
    }
    return {
      ...base,
      metricType: "funnel",
      numerator: null,
      denominator: null,
      cappingSettings: { type: "", value: 0 },
      funnelSettings: { steps: steps.map(buildFunnelStep) },
      replaces: steps.map((s) => s.member.metric.id),
    };
  }

  const numerator = buildColumnRef(placed);
  let metricType: FactMetricInterface["metricType"] = member.metricType;
  let denominator: ColumnRef | null = null;

  if (immediate) {
    if (chain.length > 1) {
      fail("Nested denominators are only supported for binomial funnels");
    }
    metricType = "ratio";
    denominator = buildColumnRef(immediate);
  }

  // ignoreNulls drops users whose aggregated value is 0 from the mean. That is
  // exactly SUM(value) / users with a non-zero value.
  if (metric.ignoreNulls && metric.type !== "binomial") {
    if (denominator) fail("ignoreNulls is not supported on ratio metrics");
    metricType = "ratio";
    denominator = {
      factTableId: group.id,
      column: "$$distinctUsers",
      aggregateFilterColumn: numerator.column,
      aggregateFilter: "!= 0",
      rowFilters: numerator.rowFilters,
    };
  }

  return { ...base, metricType, numerator, denominator, funnelSettings: null };
}

export function groupLegacyMetricsIntoFactTables(
  metrics: MetricInterface[],
  options: LegacyMetricConversionOptions,
): LegacyMetricConversionResult {
  const errors: LegacyMetricConversionResult["errors"] = [];
  const now = new Date();

  const existing = (options.existingFactTables || []).flatMap((table) => {
    try {
      return [
        {
          table,
          ...parseSqlShape(
            table.sql,
            options.datasourceType,
            table.timestampColumn || "timestamp",
          ),
        },
      ];
    } catch (e) {
      if (!isConversionError(e)) throw e;
      return [];
    }
  });

  // Several groups can share a key when metrics map the same user id type to
  // different expressions
  const groupsByKey = new Map<string, Group[]>();
  const lookup = new Map<string, Placed>();
  for (const metric of metrics) {
    try {
      const member = parseLegacyMetric(metric, options);
      const candidates = groupsByKey.get(member.groupKey) ?? [];
      groupsByKey.set(member.groupKey, candidates);
      let group = candidates.find((g) =>
        member.userIdTypes.every(
          (t) =>
            !g.userIdExprs.has(t) ||
            g.userIdExprs.get(t) === member.columns.get(t),
        ),
      );
      if (!group) {
        group = {
          id: "",
          existing: null,
          members: [],
          userIdExprs: new Map(),
          columns: new Map(),
          renames: new Map(),
          filterAliases: new Map(),
          elevated: new Set(),
        };
        candidates.push(group);
      }
      for (const t of member.userIdTypes) {
        group.userIdExprs.set(t, member.columns.get(t) || "");
      }
      group.members.push(member);
      addSelectColumns(group, member);
      lookup.set(metric.id, { member, group });
    } catch (e) {
      if (!isConversionError(e)) throw e;
      errors.push({ metricId: metric.id, error: e.message });
    }
  }

  // Shared filters, filter columns and ids are resolved once membership is
  // final, since a later member changes what is shared and which columns the
  // table needs.
  const groups = [...groupsByKey.values()].flat();
  for (const group of groups) {
    finalizeFilters(group);
    group.existing = findExistingFactTable(group, existing);
    group.id = group.existing?.id ?? options.generateFactTableId();
  }

  const result: LegacyMetricGroup[] = [];
  const names = new Map<string, number>();
  for (const group of groups) {
    const converted: FactMetricInterface[] = [];
    for (const member of group.members) {
      try {
        converted.push(
          buildFactMetric({ member, group }, lookup, options, now),
        );
      } catch (e) {
        if (!isConversionError(e)) throw e;
        errors.push({ metricId: member.metric.id, error: e.message });
      }
    }
    if (!converted.length) continue;
    if (group.existing) {
      result.push({
        factTable: { ...group.existing, columns: buildColumns(group, now) },
        existing: true,
        metrics: converted,
      });
      continue;
    }
    const baseName = buildFactTableName(group);
    const seen = (names.get(baseName) ?? 0) + 1;
    names.set(baseName, seen);
    result.push({
      factTable: buildFactTable(
        group,
        seen > 1 ? `${baseName} (${seen})` : baseName,
        now,
      ),
      existing: false,
      metrics: converted,
    });
  }

  return { groups: result, errors };
}
