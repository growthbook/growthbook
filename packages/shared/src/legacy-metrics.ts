import { DataSourceType } from "../types/datasource";
import {
  ColumnAggregation,
  ColumnInterface,
  ColumnRef,
  FactMetricInterface,
  FactTableInterface,
  FunnelStep,
  MetricWindowSettings,
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

// Groups legacy metrics into fact tables, keyed on what must live in the table SQL

export type ExistingFactTable = Pick<
  FactTableInterface,
  "id" | "name" | "sql" | "userIdTypes" | "timestampColumn"
>;

export interface LegacyMetricGroup {
  factTable: Partial<FactTableInterface> &
    Pick<FactTableInterface, "id" | "sql" | "userIdTypes" | "columns">;
  // Matched an existing table, which should not be created again
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
  existingFactTables?: ExistingFactTable[];
  // Prepended to unqualified query-builder tables
  defaultSchema?: string;
  // Anything outside these can never join to an experiment
  userIdTypes?: string[];
  // Rebuilds a denominator that an earlier run already migrated
  getMigratedFactMetric?: (
    legacyMetricId: string,
  ) => FactMetricInterface | undefined;
  // Whether a `u_...` owner id still belongs to the organization
  isKnownOwner?: (ownerId: string) => boolean;
}

interface TypedFilter {
  rowFilter: RowFilter;
  sql: string;
}

interface SqlShape {
  from: string;
  cte?: string;
  // Kept verbatim for wildcard projections or non-additive grouped values
  sqlOverride?: string;
  sqlExprs: string[];
  columns: Map<string, string>;
  filters: TypedFilter[];
  dedupe: boolean;
  tableSuffix?: string;
  // Aggregation over a GROUP BY; the fact metric re-aggregates the raw rows
  aggregatedValue?: Pick<ColumnRef, "column" | "aggregation">;
  // Other aggregated aliases, not carried into the fact table
  aggregatedAliases: string[];
}

interface ParsedLegacyMetric extends SqlShape {
  metric: MetricInterface;
  userIdTypes: string[];
  groupKey: string;
  numerator: Pick<ColumnRef, "column" | "aggregation">;
  metricType: "proportion" | "mean";
  valueAlias?: string;
}

interface Group {
  id: string;
  existing: ExistingFactTable | null;
  members: ParsedLegacyMetric[];
  userIdExprs: Map<string, string>;
  columns: Map<string, string>;
  renames: Map<string, Map<string, string>>;
  filterAliases: Map<string, string>;
  // Shared by every member, so moved into the fact table WHERE
  elevated: Set<string>;
}

// `t.event_name` -> event_name; null when not a plain column reference
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

// These are static per metric; runtime ones like startDate are left alone
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
  if (parsed.select[0].expr === "*") {
    return {
      from: parsed.from,
      sqlOverride: sql.trim(),
      sqlExprs: [],
      columns: new Map(),
      filters: [],
      dedupe: false,
      aggregatedAliases: [],
    };
  }
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
    // Re-aggregating raw rows gives the same total; other aliases are unused
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
  // SUM of group maxima/distinct counts is not MAX/COUNT DISTINCT of raw rows.
  if (
    aggregatedValue?.aggregation === "max" ||
    aggregatedValue?.aggregation === "count distinct"
  ) {
    return {
      from: parsed.from,
      sqlOverride: sql.trim(),
      sqlExprs: [],
      columns: new Map([...columns.keys()].map((alias) => [alias, alias])),
      filters: [],
      dedupe: false,
      aggregatedAliases,
      aggregatedValue: { column: "value", aggregation: "sum" },
    };
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
    ...(parsed.cte ? { cte: parsed.cte } : {}),
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

// Mirrors the SQL the legacy query engine generated from the builder fields
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

// Legacy ran the aggregation over each user's `value` rows
function parseAggregation(
  metric: MetricInterface,
  aggregatedValue?: SqlShape["aggregatedValue"],
): Pick<ColumnRef, "column" | "aggregation"> & {
  metricType: "proportion" | "mean";
  // COUNT(value) counts rows with a value, unlike $$count
  requireNonNullValue?: boolean;
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
  // The builder ignored custom aggregations and used these instead
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
    return {
      column: "$$count",
      metricType: "mean",
      // The legacy engine rewrites COUNT(*) to COUNT(value).
      requireNonNullValue: true,
    };
  }
  const aggregation = known[normalized];
  if (!aggregation) fail(`Unsupported custom aggregation: ${agg}`);
  return { column: "value", aggregation, metricType: "mean" };
}

function parseLegacyMetric(
  metric: MetricInterface,
  options: LegacyMetricConversionOptions,
): ParsedLegacyMetric {
  // Synced from elsewhere, so a migration here is overwritten on next sync
  if (metric.managedBy === "config") {
    fail("Defined in config.yml; migrate it there instead");
  }
  if (metric.managedBy === "api") {
    fail("Managed by the API; migrate it in the system that syncs it");
  }

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
  // The legacy engine read these names off the wildcard rows, so they exist
  if (shape.sqlOverride && !columns.size) {
    configured.forEach((t) => columns.set(t, t));
    columns.set("timestamp", "timestamp");
    if (metric.type !== "binomial") columns.set("value", "value");
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

  const { metricType, requireNonNullValue, ...parsed } = parseAggregation(
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
      numerator = { column: "$$count" };
    }
    if (constant && numerator.column !== "value") {
      columns.delete("value");
    } else {
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

  if (requireNonNullValue && valueExpr && !isNumericLiteral(valueExpr)) {
    shape.filters.push({
      rowFilter: { operator: "not_null", column: valueExpr },
      sql: `${valueExpr} IS NOT NULL`,
    });
  }

  const groupKey = JSON.stringify([
    shape.from,
    shape.sqlOverride ?? null,
    shape.cte ?? null,
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

// Renames with a numeric suffix when the alias is taken by another expression
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

// What stays a row filter needs its source column in the SELECT
function finalizeFilters(group: Group) {
  const [first, ...rest] = group.members;
  // Verbatim SQL has no outer SELECT to hold an elevated filter
  group.elevated = first.sqlOverride
    ? new Set()
    : new Set(
        first.filters
          .filter((f) =>
            rest.every((m) => m.filters.some((g) => g.sql === f.sql)),
          )
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

// Reusable when it reads the same rows and exposes every column needed
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
      (e.cte ?? null) === (first.cte ?? null) &&
      (e.sqlOverride ?? null) === (first.sqlOverride ?? null) &&
      JSON.stringify(e.sqlExprs) === JSON.stringify(first.sqlExprs) &&
      // Elevated filters are omitted from metric row filters, so the table
      // must apply exactly those predicates.
      new Set(e.filters.map((f) => f.sql)).size === group.elevated.size &&
      e.filters.every((f) => group.elevated.has(f.sql)) &&
      (e.dedupe || !needsDedupe) &&
      [...userIdTypes].every((t) => e.table.userIdTypes.includes(t)) &&
      [...group.columns].every(
        ([alias, expr]) => e.columns.get(alias) === expr,
      ),
  );
  return match?.table ?? null;
}

function buildFactTableSql(group: Group): string {
  const { from, cte, sqlOverride } = group.members[0];
  if (sqlOverride) return sqlOverride;
  const cols = [...group.columns].map(([alias, expr]) =>
    bareColumnName(expr) === alias ? expr : `${expr} AS ${alias}`,
  );
  const where = [
    ...group.elevated,
    ...new Set(group.members.flatMap((m) => m.sqlExprs)),
  ];
  // Every variant is the same date range, so keep the most permissive
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
    (cte ? `${cte}\n` : "") +
    `SELECT ${distinct}\n  ${cols.join(",\n  ")}\nFROM ${from}` +
    (where.length
      ? `\nWHERE ${where.map((w) => `(${w})`).join("\n  AND ")}`
      : "")
  );
}

// `schema.orders o` -> "orders", or "orders - purchase" with an elevated filter
function buildFactTableName(group: Group): string {
  const { from, metric, filters } = group.members[0];
  const table = from.split(/\s/)[0];
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
  // Fact metrics only allow `count distinct` on a string column
  const countDistinct = new Set<string>();
  for (const m of group.members) {
    if (!m.valueAlias) continue;
    const alias = group.renames.get(m.metric.id)?.get(m.valueAlias);
    valueTypes.set(alias ?? m.valueAlias, m.metric.type);
    if (m.numerator.aggregation === "count distinct") {
      countDistinct.add(alias ?? m.valueAlias);
    }
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
          : countDistinct.has(column)
            ? "string"
            : valueType
              ? "number"
              : "",
      numberFormat: countDistinct.has(column)
        ? ""
        : valueType === "revenue"
          ? "currency"
          : valueType === "duration"
            ? "time:seconds"
            : "",
      deleted: false,
    };
  });
}

// Only a `u_...` id is validated on write, and fails once the user leaves
function resolveOwner(
  owner: string | undefined,
  options: LegacyMetricConversionOptions,
): string {
  if (!owner) return "";
  if (owner.startsWith("u_") && options.isKnownOwner?.(owner) === false) {
    return "";
  }
  return owner;
}

function buildFactTable(
  group: Group,
  name: string,
  now: Date,
  options: LegacyMetricConversionOptions,
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
    owner: resolveOwner(first.owner, options),
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

export function legacyIdOf(metric: FactMetricInterface): string {
  return metric.replaces?.[0] || "";
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

type ChainLink =
  | { kind: "pending"; placed: Placed }
  | { kind: "migrated"; factMetric: FactMetricInterface };

// Only what this converter itself produces; anything else was hand-edited
function migratedIsBinomial(factMetric: FactMetricInterface): boolean {
  return (
    factMetric.metricType === "proportion" || factMetric.metricType === "funnel"
  );
}

function linkIsBinomial(link: ChainLink): boolean {
  return link.kind === "pending"
    ? link.placed.member.metric.type === "binomial"
    : migratedIsBinomial(link.factMetric);
}

function linkColumnRef(link: ChainLink): ColumnRef {
  if (link.kind === "pending") return buildColumnRef(link.placed);
  const { factMetric } = link;
  // Its own denominator is a level of nesting the legacy path rejects too
  if (factMetric.metricType === "ratio") {
    fail("Nested denominators are only supported for binomial funnels");
  }
  if (!factMetric.numerator) {
    fail(
      `Denominator metric ${legacyIdOf(factMetric) || factMetric.id} was already migrated and cannot be used as a ratio denominator`,
    );
  }
  return factMetric.numerator;
}

function linkFunnelSteps(link: ChainLink): FunnelStep[] {
  if (link.kind === "pending") return [buildFunnelStep(link.placed)];
  const { factMetric } = link;
  if (factMetric.metricType === "funnel") {
    return factMetric.funnelSettings?.steps ?? [];
  }
  return [migratedFunnelStep(factMetric)];
}

function denominatorChain(
  metric: MetricInterface,
  lookup: Map<string, Placed>,
  options: LegacyMetricConversionOptions,
): ChainLink[] {
  const chain: ChainLink[] = [];
  let id = metric.denominator;
  while (id) {
    if (chain.length >= MAX_FUNNEL_STEPS) fail("Denominator chain is too long");
    const den = lookup.get(id);
    if (den) {
      chain.unshift({ kind: "pending", placed: den });
      id = den.member.metric.denominator;
      continue;
    }
    const factMetric = options.getMigratedFactMetric?.(id);
    if (!factMetric) fail(`Denominator metric ${id} could not be converted`);
    // Already migrated: its Fact Metric covers the rest of the chain
    chain.unshift({ kind: "migrated", factMetric });
    break;
  }
  return chain;
}

// A binomial denominator gated conversion on the previous step: a funnel
function toFunnelStep(
  name: string,
  factTableId: string,
  rowFilters: RowFilter[],
  windowSettings: MetricWindowSettings,
): FunnelStep {
  if (windowSettings.type === "lookback") {
    fail("Lookback windows are not supported in funnel steps");
  }
  if (windowSettings.delayValue) {
    fail("Conversion delays are not supported in funnel steps");
  }
  return {
    name,
    factTableId,
    rowFilters,
    optional: false,
    conversionWindow:
      windowSettings.type === "conversion"
        ? { unit: windowSettings.windowUnit, value: windowSettings.windowValue }
        : null,
  };
}

function buildFunnelStep(placed: Placed): FunnelStep {
  const { windowSettings, name } = placed.member.metric;
  return toFunnelStep(
    name,
    placed.group.id,
    buildColumnRef(placed).rowFilters ?? [],
    windowSettings,
  );
}

function migratedFunnelStep(factMetric: FactMetricInterface): FunnelStep {
  const { numerator, name, windowSettings } = factMetric;
  if (!numerator) {
    fail(
      `Denominator metric ${legacyIdOf(factMetric) || factMetric.id} was already migrated and cannot be used as a funnel step`,
    );
  }
  return toFunnelStep(
    name,
    numerator.factTableId,
    numerator.rowFilters ?? [],
    windowSettings,
  );
}

function buildFactMetric(
  placed: Placed,
  lookup: Map<string, Placed>,
  options: LegacyMetricConversionOptions,
  now: Date,
): FactMetricInterface {
  const { member, group } = placed;
  const { metric } = member;
  const chain = denominatorChain(metric, lookup, options);

  const base = {
    id: options.generateFactMetricId(metric),
    organization: metric.organization,
    managedBy: metric.managedBy === "api" ? ("api" as const) : ("" as const),
    owner: resolveOwner(metric.owner, options),
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
    replaces: [metric.id],
  };

  const immediate = chain[chain.length - 1];
  // A binomial denominator gated conversion on the previous step: a funnel
  const priorSteps =
    immediate && linkIsBinomial(immediate)
      ? chain.flatMap(linkFunnelSteps)
      : [];
  // Except over a single step, where a ratio keeps the metric's own value
  const isRatioOverStep = priorSteps.length === 1 && metric.type !== "binomial";

  if (priorSteps.length && !isRatioOverStep) {
    if (metric.type !== "binomial") {
      fail(
        `A funnel counts users, so this ${metric.type} metric's value would be lost. Rebuild it by hand as a ratio if that is what you want.`,
      );
    }
    const steps = [...priorSteps, buildFunnelStep(placed)];
    if (steps.length > MAX_FUNNEL_STEPS) fail("Denominator chain is too long");
    if (
      new Set(steps.map((s) => s.factTableId)).size > MAX_FUNNEL_FACT_TABLES
    ) {
      fail(`Funnels can span at most ${MAX_FUNNEL_FACT_TABLES} fact tables`);
    }
    return {
      ...base,
      metricType: "funnel",
      numerator: null,
      denominator: null,
      cappingSettings: { type: "", value: 0 },
      // Steps carry the windows; a metric-level one would also cap from exposure
      windowSettings: {
        type: "",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 0,
        windowUnit: "hours",
      },
      funnelSettings: { steps },
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
    denominator = linkColumnRef(immediate);
  }

  // ignoreNulls is exactly SUM(value) over users with a non-zero value
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

  // One key can hold several groups when metrics disagree on an id expression
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

  // Resolved once membership is final: a later member changes both
  const groups = [...groupsByKey.values()].flat();
  for (const group of groups) {
    finalizeFilters(group);
    group.existing = findExistingFactTable(group, existing);
    group.id = group.existing?.id ?? options.generateFactTableId();
  }

  const result: LegacyMetricGroup[] = [];
  // Taken by existing tables and earlier groups; case-insensitive
  const usedNames = new Set(
    (options.existingFactTables || []).flatMap((t) =>
      t.name ? [t.name.toLowerCase()] : [],
    ),
  );
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
    let name = baseName;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) {
      name = `${baseName} (${n})`;
    }
    usedNames.add(name.toLowerCase());
    result.push({
      factTable: buildFactTable(group, name, now, options),
      existing: false,
      metrics: converted,
    });
  }

  return { groups: result, errors };
}
