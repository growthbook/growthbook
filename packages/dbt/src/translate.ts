// Structural subset of dbt's manifest.json that the translator reads. Both the
// legacy YAML spec (measures + type_params.measure) and the v1.12 spec
// (metric_aggregation_params) land in this shape after `dbt parse`.
export interface DbtConfig {
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
}
export interface DbtEntity {
  name: string;
  type: string;
  expr?: string | null;
}
export interface DbtDimension {
  name: string;
  type: string;
  expr?: string | null;
}
export interface DbtAggParams {
  percentile?: number | null;
  use_discrete_percentile?: boolean | null;
}
export interface DbtMeasure {
  name: string;
  agg: string;
  expr?: string | null;
  label?: string | null;
  agg_params?: DbtAggParams | null;
  agg_time_dimension?: string | null;
  non_additive_dimension?: unknown;
}
export interface DbtSemanticModel {
  name: string;
  label?: string | null;
  description?: string | null;
  node_relation?: { relation_name?: string | null } | null;
  defaults?: { agg_time_dimension?: string | null } | null;
  primary_entity?: string | null;
  entities?: DbtEntity[] | null;
  dimensions?: DbtDimension[] | null;
  measures?: DbtMeasure[] | null;
  config?: DbtConfig | null;
  tags?: string[] | null;
}
export interface DbtFilter {
  where_filters?: { where_sql_template: string }[] | null;
}
export interface DbtInput {
  name: string;
  filter?: DbtFilter | null;
  alias?: string | null;
}
export interface DbtWindow {
  count: number;
  granularity: string;
}
export interface DbtMetricTypeParams {
  measure?: DbtInput | null;
  numerator?: DbtInput | null;
  denominator?: DbtInput | null;
  expr?: string | null;
  window?: DbtWindow | null;
  grain_to_date?: string | null;
  metrics?: DbtInput[] | null;
  conversion_type_params?: {
    base_measure?: DbtInput | null;
    base_metric?: DbtInput | null;
    conversion_measure?: DbtInput | null;
    conversion_metric?: DbtInput | null;
    entity: string;
    calculation?: string | null;
    window?: DbtWindow | null;
    constant_properties?: unknown[] | null;
  } | null;
  cumulative_type_params?: {
    window?: DbtWindow | null;
    grain_to_date?: string | null;
    metric?: DbtInput | null;
  } | null;
  metric_aggregation_params?: {
    semantic_model: string;
    agg: string;
    agg_params?: DbtAggParams | null;
    agg_time_dimension?: string | null;
    non_additive_dimension?: unknown;
  } | null;
}
export interface DbtMetric {
  name: string;
  label?: string | null;
  description?: string | null;
  type: string;
  type_params?: DbtMetricTypeParams | null;
  filter?: DbtFilter | null;
  config?: DbtConfig | null;
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
}
export interface DbtNode {
  name: string;
  resource_type: string;
  relation_name?: string | null;
  config?: DbtConfig | null;
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
}
export interface DbtManifest {
  nodes?: Record<string, DbtNode> | DbtNode[] | null;
  semantic_models?:
    | Record<string, DbtSemanticModel>
    | DbtSemanticModel[]
    | null;
  metrics?: Record<string, DbtMetric> | DbtMetric[] | null;
}

// Subset of the /bulk-import/facts payload this tool emits. The API validates
// the full shape; these types only keep the translator honest.
export type WindowUnit = "minutes" | "hours" | "days" | "weeks";
export type RowFilterOperator =
  | "sql_expr"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not_in"
  | "is_null"
  | "not_null"
  | "is_true"
  | "is_false";
export interface RowFilter {
  operator: RowFilterOperator;
  column?: string;
  values?: string[];
}
export interface ColumnRef {
  factTableId: string;
  column?: string;
  aggregation?: "max" | "count distinct";
  rowFilters?: RowFilter[];
}
export interface FunnelStep {
  name: string;
  factTableId: string;
  rowFilters: RowFilter[];
  optional: boolean;
  conversionWindow?: { unit: WindowUnit; value: number };
}
export interface FactTableColumn {
  column: string;
  datatype: "" | "number" | "string" | "boolean" | "date";
  isVirtual?: boolean;
  sql?: string;
}
export interface FactTableData {
  name: string;
  description?: string;
  tags?: string[];
  datasource: string;
  userIdTypes: string[];
  userIdColumns?: Record<string, string>;
  sql: string;
  timestampColumn: string;
  columns: FactTableColumn[];
  [key: string]: unknown;
}
export interface FactMetricData {
  name: string;
  description?: string;
  tags?: string[];
  metricType: string;
  numerator?: ColumnRef;
  denominator?: ColumnRef;
  windowSettings?:
    | { type: "lookback"; windowValue: number; windowUnit: WindowUnit }
    | { type: "none" };
  quantileSettings?: { type: "event"; quantile: number; ignoreZeros: boolean };
  funnelSettings?: { steps: FunnelStep[] };
  [key: string]: unknown;
}
export interface BulkImportPayload {
  defaultManagedBy: "dbt";
  factTables: { id: string; data: FactTableData }[];
  factMetrics: { id: string; data: FactMetricData }[];
}
export interface TranslateWarning {
  level: "skipped" | "note";
  resource: string;
  message: string;
}
export interface TranslateOptions {
  datasource: string;
  // dbt entity name -> GrowthBook identifier type. Unmapped entities keep their name.
  entities?: Record<string, string>;
  // Identifier types the Data Source defines. When given, entities that don't map to one are ignored.
  idTypes?: string[];
  // Name globs or `tag:<tag>` matched against metrics and semantic models.
  select?: string[];
  exclude?: string[];
}
export interface TranslateResult {
  payload: BulkImportPayload;
  warnings: TranslateWarning[];
}

class Unsupported extends Error {}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isIdent = (s: string) => IDENT.test(s);
const sqlExpr = (expr: string) => (isIdent(expr) ? expr : `(${expr})`);
const qualify = (alias: string, expr: string) =>
  isIdent(expr) ? `${alias}.${expr}` : expr;

const values = <T>(x: Record<string, T> | T[] | null | undefined): T[] =>
  x ? Object.values(x) : [];

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function omit(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k)),
  );
}

type WithMeta = {
  config?: DbtConfig | null;
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
};
function gbMeta(x: WithMeta): Record<string, unknown> {
  const gb = (x.config?.meta ?? x.meta)?.growthbook;
  return isRecord(gb) ? gb : {};
}
const tagsOf = (x: WithMeta): string[] => x.tags ?? x.config?.tags ?? [];
const filtersOf = (f?: DbtFilter | null): string[] =>
  (f?.where_filters ?? []).map((w) => w.where_sql_template);

interface Window {
  value: number;
  unit: WindowUnit;
  note?: string;
}
function toWindow(w: DbtWindow): Window {
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

function matches(
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

// Structured row filters are compiled by GrowthBook with no warehouse round
// trip, unlike sql_expr, which is test-run against the warehouse on every
// create. Numeric and boolean literals also need the column typed, or the
// value is quoted as a string. Anything this doesn't match stays sql_expr.
export function parseRowFilter(sql: string): {
  filter: RowFilter & { column: string };
  datatype?: "number" | "boolean";
} | null {
  const hint = (lit: Literal) =>
    lit.kind === "string" ? {} : { datatype: lit.kind };

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
    if (first.kind === "boolean") return null;
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
  if (!lit) return null;
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

interface MeasureDef {
  model: DbtSemanticModel;
  name: string;
  label: string;
  agg: string;
  expr: string;
  aggParams?: DbtAggParams | null;
  timeDim: string;
  nonAdditive: boolean;
  filters: string[];
}

interface Join {
  target: DbtSemanticModel;
  fk: DbtEntity;
  pk: DbtEntity;
  dims: Set<string>;
}

// One measure read by one metric. Several usages collapse into one fact table.
interface Usage {
  model: DbtSemanticModel;
  timeDim: string;
  joins: Map<string, Join>;
  columns: FactTableColumn[];
  factTableId: string;
}

interface Ref {
  ref: { factTableId: string };
  usage: Usage;
}

interface Draft {
  metric: DbtMetric;
  data: FactMetricData;
  refs: Ref[];
}

interface TableDraft {
  id: string;
  model: DbtSemanticModel;
  timeDim: string;
  joins: Map<string, Join>;
  columns: Map<string, FactTableColumn>;
}

const NESTED_AGGS = ["average", "median", "percentile"];

export function translate(
  manifest: DbtManifest,
  opts: TranslateOptions,
): TranslateResult {
  const warnings: TranslateWarning[] = [];
  const models = values(manifest.semantic_models);
  const modelsByName = new Map(models.map((m) => [m.name, m]));
  const metrics = values(manifest.metrics);
  const metricsByName = new Map(metrics.map((m) => [m.name, m]));
  const measureIndex = new Map<
    string,
    { model: DbtSemanticModel; measure: DbtMeasure }
  >();
  for (const model of models) {
    for (const measure of model.measures ?? []) {
      measureIndex.set(measure.name, { model, measure });
    }
  }

  const modelBlocked = (m: DbtSemanticModel) =>
    gbMeta(m).enabled === false || matches(opts.exclude, m.name, tagsOf(m));

  const findEntity = (model: DbtSemanticModel, name: string) =>
    (model.entities ?? []).find((e) => e.name === name);
  const findDim = (model: DbtSemanticModel, name: string) =>
    (model.dimensions ?? []).find((d) => d.name === name);
  const ownsEntity = (model: DbtSemanticModel, entity: string) =>
    model.primary_entity === entity ||
    (model.entities ?? []).some(
      (e) => e.name === entity && e.type !== "foreign",
    );
  const dimSql = (d: DbtDimension) => sqlExpr(d.expr ?? d.name);

  function measureDef(
    model: DbtSemanticModel,
    measure: DbtMeasure,
    filters: string[],
  ): MeasureDef {
    const timeDim =
      measure.agg_time_dimension ?? model.defaults?.agg_time_dimension;
    if (!timeDim) {
      throw new Unsupported(
        `semantic model "${model.name}" has no agg_time_dimension`,
      );
    }
    return {
      model,
      name: measure.name,
      label: measure.label ?? measure.name,
      agg: measure.agg,
      expr: measure.expr ?? measure.name,
      aggParams: measure.agg_params,
      timeDim,
      nonAdditive: (measure.non_additive_dimension ?? null) !== null,
      filters,
    };
  }

  function resolveMeasure(input: DbtInput): MeasureDef {
    const found = measureIndex.get(input.name);
    if (!found) throw new Unsupported(`measure "${input.name}" not found`);
    return measureDef(found.model, found.measure, filtersOf(input.filter));
  }

  function resolveSimple(name: string, extraFilters: string[]): MeasureDef {
    const metric = metricsByName.get(name);
    if (!metric) throw new Unsupported(`metric "${name}" not found`);
    if (metric.type !== "simple") {
      throw new Unsupported(
        `input metric "${name}" is a ${metric.type} metric; only simple metrics can be inputs`,
      );
    }
    const tp = metric.type_params ?? {};
    const filters = [...filtersOf(metric.filter), ...extraFilters];
    const p = tp.metric_aggregation_params;
    if (p) {
      const model = modelsByName.get(p.semantic_model);
      if (!model) {
        throw new Unsupported(`semantic model "${p.semantic_model}" not found`);
      }
      return measureDef(
        model,
        {
          name: metric.name,
          agg: p.agg,
          expr: tp.expr,
          label: metric.label,
          agg_params: p.agg_params,
          agg_time_dimension: p.agg_time_dimension,
          non_additive_dimension: p.non_additive_dimension,
        },
        filters,
      );
    }
    if (tp.measure) {
      const def = resolveMeasure(tp.measure);
      return {
        ...def,
        label: metric.label ?? def.label,
        filters: [...def.filters, ...filters],
      };
    }
    throw new Unsupported(
      `simple metric "${name}" has neither a measure nor aggregation params`,
    );
  }

  // Legacy cumulative/conversion inputs name a measure; everything else names a metric.
  // A measure and the metric dbt creates from it share a name, so whether an
  // input names a measure or a metric comes from the field it sits in.
  type InputKind = "measure" | "metric";
  const resolveInput = (input: DbtInput, kind: InputKind): MeasureDef =>
    kind === "metric"
      ? resolveSimple(input.name, filtersOf(input.filter))
      : resolveMeasure(input);
  const pick = (
    metric: DbtInput | null | undefined,
    measure: DbtInput | null | undefined,
  ): [DbtInput | null | undefined, InputKind] =>
    metric ? [metric, "metric"] : [measure, "measure"];

  const withFilters = (def: MeasureDef, filters: string[]): MeasureDef => ({
    ...def,
    filters: [...def.filters, ...filters],
  });

  const JINJA =
    /\{\{\s*(Dimension|TimeDimension|Entity|Metric)\s*\(\s*(['"])([^'"]+)\2[^}]*\)\s*\}\}/g;

  function renderFilter(template: string, usage: Usage): string {
    const model = usage.model;
    const sql = template.replace(
      JINJA,
      (match, kind: string, quote: string, ref: string) => {
        if (kind === "Entity") {
          const e = findEntity(model, ref);
          if (!e) {
            throw new Unsupported(
              `filter references entity "${ref}", which is not on "${model.name}"`,
            );
          }
          return sqlExpr(e.expr ?? e.name);
        }
        if (kind !== "Dimension") {
          throw new Unsupported(
            `filter uses ${kind}(), which has no GrowthBook equivalent`,
          );
        }
        const i = ref.indexOf("__");
        const entity =
          i === -1 ? (model.primary_entity ?? "") : ref.slice(0, i);
        const dim = i === -1 ? ref : ref.slice(i + 2);
        if (i === -1 || ownsEntity(model, entity)) {
          const d = findDim(model, dim);
          if (!d) {
            throw new Unsupported(
              `dimension "${ref}" not found on "${model.name}"`,
            );
          }
          return dimSql(d);
        }
        const fk = findEntity(model, entity);
        if (!fk) {
          throw new Unsupported(
            `filter on "${ref}" needs entity "${entity}", which "${model.name}" does not have (multi-hop joins are not supported)`,
          );
        }
        const target = models.find(
          (m) => m !== model && ownsEntity(m, entity) && findDim(m, dim),
        );
        const pk = target && findEntity(target, entity);
        if (!target || !pk) {
          throw new Unsupported(
            `no semantic model with primary entity "${entity}" defines dimension "${dim}"`,
          );
        }
        const join = usage.joins.get(entity) ?? {
          target,
          fk,
          pk,
          dims: new Set<string>(),
        };
        join.dims.add(dim);
        usage.joins.set(entity, join);
        return `${entity}__${dim}`;
      },
    );
    if (sql.includes("{{")) {
      throw new Unsupported(`filter "${template}" could not be translated`);
    }
    return sql;
  }

  function measureRef(def: MeasureDef): {
    usage: Usage;
    ref: ColumnRef;
    notNull: () => RowFilter;
  } {
    if (def.nonAdditive) {
      throw new Unsupported(
        `measure "${def.name}" uses non_additive_dimension, which has no GrowthBook equivalent`,
      );
    }
    const usage: Usage = {
      model: def.model,
      timeDim: def.timeDim,
      joins: new Map(),
      columns: [],
      factTableId: "",
    };
    // Pushed after the measure's own column so a measure's inferred type wins.
    const filterColumns: FactTableColumn[] = [];
    const rowFilters = def.filters.map((f): RowFilter => {
      const sql = renderFilter(f, usage);
      const parsed = parseRowFilter(sql);
      if (!parsed) return { operator: "sql_expr", values: [sql] };
      if (parsed.datatype) {
        filterColumns.push({
          column: parsed.filter.column,
          datatype: parsed.datatype,
        });
      }
      return parsed.filter;
    });
    const ref: ColumnRef = { factTableId: "" };

    const column = (datatype: FactTableColumn["datatype"]) => {
      if (isIdent(def.expr)) {
        usage.columns.push({ column: def.expr, datatype });
        return def.expr;
      }
      // The API requires virtual column ids to end in _vc.
      const name = `${def.name}_vc`;
      usage.columns.push({
        column: name,
        datatype,
        isVirtual: true,
        sql: def.expr,
      });
      return name;
    };
    // dbt's COUNT(expr) and AVG(expr) skip nulls; $$count counts rows.
    const notNull = (): RowFilter =>
      isIdent(def.expr)
        ? { operator: "not_null", column: def.expr }
        : { operator: "sql_expr", values: [`(${def.expr}) IS NOT NULL`] };
    const isKey = (def.model.entities ?? []).some(
      (e) => e.type !== "foreign" && (e.expr ?? e.name) === def.expr,
    );

    switch (def.agg) {
      case "count":
        ref.column = "$$count";
        if (!isKey) rowFilters.push(notNull());
        break;
      case "sum":
      case "average":
      case "median":
      case "percentile":
        ref.column = column("number");
        break;
      case "max":
        ref.column = column("number");
        ref.aggregation = "max";
        break;
      case "count_distinct":
        ref.column = column("string");
        ref.aggregation = "count distinct";
        break;
      case "sum_boolean": {
        const name = `${def.name}_vc`;
        usage.columns.push({
          column: name,
          datatype: "number",
          isVirtual: true,
          sql: `CASE WHEN ${def.expr} THEN 1 ELSE 0 END`,
        });
        ref.column = name;
        break;
      }
      case "min":
        throw new Unsupported(`agg "min" has no GrowthBook aggregation`);
      default:
        throw new Unsupported(`unknown agg "${def.agg}"`);
    }
    if (rowFilters.length) ref.rowFilters = rowFilters;
    usage.columns.push(...filterColumns);
    return { usage, ref, notNull };
  }

  function simpleData(def: MeasureDef): Omit<Draft, "metric"> {
    const { usage, ref, notNull } = measureRef(def);
    const data: FactMetricData = {
      name: def.label,
      metricType: "mean",
      numerator: ref,
    };
    const refs: Ref[] = [{ ref, usage }];
    if (def.agg === "average") {
      const den: ColumnRef = {
        factTableId: "",
        column: "$$count",
        rowFilters: [...(ref.rowFilters ?? []), notNull()],
      };
      refs.push({ ref: den, usage });
      return { data: { ...data, metricType: "ratio", denominator: den }, refs };
    }
    if (def.agg === "median" || def.agg === "percentile") {
      const q =
        def.agg === "median" ? 0.5 : (def.aggParams?.percentile ?? null);
      if (q === null) {
        throw new Unsupported(
          `percentile measure "${def.name}" has no percentile`,
        );
      }
      if (def.aggParams?.use_discrete_percentile) {
        warnings.push({
          level: "note",
          resource: `metric ${def.name}`,
          message: "discrete percentile is computed as a continuous quantile",
        });
      }
      return {
        data: {
          ...data,
          metricType: "quantile",
          quantileSettings: {
            type: "event",
            quantile: Math.round(q * 1000) / 1000,
            ignoreZeros: false,
          },
        },
        refs,
      };
    }
    return { data, refs };
  }

  function ratioData(
    name: string,
    num: MeasureDef,
    den: MeasureDef,
  ): Omit<Draft, "metric"> {
    for (const d of [num, den]) {
      if (NESTED_AGGS.includes(d.agg)) {
        throw new Unsupported(
          `ratio input "${d.name}" is itself a ${d.agg}; nested ratios are not supported`,
        );
      }
    }
    const n = measureRef(num);
    const d = measureRef(den);
    return {
      data: { name, metricType: "ratio", numerator: n.ref, denominator: d.ref },
      refs: [n, d],
    };
  }

  function metricDraft(metric: DbtMetric): Omit<Draft, "metric"> {
    const tp = metric.type_params ?? {};
    const name = metric.label ?? metric.name;
    const filters = filtersOf(metric.filter);
    const required = (input: DbtInput | null | undefined, what: string) => {
      if (!input) throw new Unsupported(`${metric.type} metric has no ${what}`);
      return input;
    };
    const window = (w: DbtWindow): Window => {
      const out = toWindow(w);
      if (out.note) {
        warnings.push({
          level: "note",
          resource: `metric ${metric.name}`,
          message: out.note,
        });
      }
      return out;
    };
    switch (metric.type) {
      case "simple":
        return simpleData(resolveSimple(metric.name, []));
      case "ratio":
        return ratioData(
          name,
          withFilters(
            resolveInput(required(tp.numerator, "numerator"), "metric"),
            filters,
          ),
          withFilters(
            resolveInput(required(tp.denominator, "denominator"), "metric"),
            filters,
          ),
        );
      case "cumulative": {
        const ctp = tp.cumulative_type_params;
        if (ctp?.grain_to_date ?? tp.grain_to_date) {
          throw new Unsupported(
            "grain_to_date (period-to-date) has no GrowthBook equivalent",
          );
        }
        const [input, kind] = pick(ctp?.metric, tp.measure);
        const def = withFilters(
          resolveInput(required(input, "input metric"), kind),
          filters,
        );
        const out = simpleData({ ...def, label: name });
        const dbtWindow = ctp?.window ?? tp.window;
        if (dbtWindow) {
          const w = window(dbtWindow);
          out.data.windowSettings = {
            type: "lookback",
            windowValue: w.value,
            windowUnit: w.unit,
          };
        }
        return out;
      }
      case "conversion": {
        const c = tp.conversion_type_params;
        if (!c) throw new Unsupported("conversion metric has no parameters");
        if (c.constant_properties?.length) {
          throw new Unsupported(
            "constant_properties cannot be expressed as a funnel",
          );
        }
        if (c.calculation === "conversions") {
          throw new Unsupported(
            "calculation: conversions is not supported (funnels report a rate)",
          );
        }
        const [baseInput, baseKind] = pick(c.base_metric, c.base_measure);
        const [convInput, convKind] = pick(
          c.conversion_metric,
          c.conversion_measure,
        );
        const base = withFilters(
          resolveInput(required(baseInput, "base"), baseKind),
          filters,
        );
        const conv = withFilters(
          resolveInput(required(convInput, "conversion"), convKind),
          filters,
        );
        // Funnels join steps on the experiment's identifier, so the dbt entity
        // must be one; a session- or order-keyed conversion can't be expressed.
        const idType = opts.entities?.[c.entity] ?? c.entity;
        if (opts.idTypes && !opts.idTypes.includes(idType)) {
          throw new Unsupported(
            `conversion entity "${c.entity}" is not a Data Source identifier type; funnels join events on the experiment's identifier`,
          );
        }
        for (const d of [base, conv]) {
          if (!findEntity(d.model, c.entity)) {
            throw new Unsupported(
              `entity "${c.entity}" is not an entity of "${d.model.name}"`,
            );
          }
        }
        const b = measureRef(base);
        const v = measureRef(conv);
        const step = (r: ColumnRef, label: string): FunnelStep => ({
          name: label,
          factTableId: "",
          rowFilters: r.rowFilters ?? [],
          optional: false,
        });
        const s1 = step(b.ref, base.label);
        const s2 = step(v.ref, conv.label);
        if (c.window) {
          const w = window(c.window);
          s2.conversionWindow = { unit: w.unit, value: w.value };
        }
        return {
          data: {
            name,
            metricType: "funnel",
            funnelSettings: { steps: [s1, s2] },
          },
          refs: [
            { ref: s1, usage: b.usage },
            { ref: s2, usage: v.usage },
          ],
        };
      }
      case "derived": {
        const m = /^\s*([A-Za-z_]\w*)\s*\/\s*([A-Za-z_]\w*)\s*$/.exec(
          tp.expr ?? "",
        );
        if (!m) {
          throw new Unsupported(
            'derived metrics are not supported (only "a / b" maps to a ratio)',
          );
        }
        const input = (alias: string) => {
          const found = (tp.metrics ?? []).find(
            (i) => (i.alias ?? i.name) === alias,
          );
          if (!found) throw new Unsupported(`unknown derived input "${alias}"`);
          return withFilters(resolveInput(found, "metric"), filters);
        };
        return ratioData(name, input(m[1]), input(m[2]));
      }
      default:
        throw new Unsupported(`unknown metric type "${metric.type}"`);
    }
  }

  function inputs(metric: DbtMetric): [DbtInput, InputKind][] {
    const tp = metric.type_params ?? {};
    const c = tp.conversion_type_params;
    const all: [DbtInput | null | undefined, InputKind][] = [
      [tp.measure, "measure"],
      [tp.numerator, "metric"],
      [tp.denominator, "metric"],
      ...(tp.metrics ?? []).map((m): [DbtInput, InputKind] => [m, "metric"]),
      [tp.cumulative_type_params?.metric, "metric"],
      [c?.base_metric, "metric"],
      [c?.base_measure, "measure"],
      [c?.conversion_metric, "metric"],
      [c?.conversion_measure, "measure"],
    ];
    return all.filter(
      (e): e is [DbtInput, InputKind] => (e[0] ?? null) !== null,
    );
  }

  // Selection runs on this before anything is translated, so unselected
  // metrics neither warn nor widen the join sets of the tables that are synced.
  function modelsOf(
    metric: DbtMetric,
    seen = new Set<string>(),
  ): DbtSemanticModel[] {
    if (seen.has(metric.name)) return [];
    seen.add(metric.name);
    const own = metric.type_params?.metric_aggregation_params?.semantic_model;
    const models = [own ? modelsByName.get(own) : undefined];
    for (const [input, kind] of inputs(metric)) {
      const m = kind === "metric" ? metricsByName.get(input.name) : undefined;
      if (m) models.push(...modelsOf(m, seen));
      else models.push(measureIndex.get(input.name)?.model);
    }
    return [
      ...new Set(
        models.filter((m): m is DbtSemanticModel => (m ?? null) !== null),
      ),
    ];
  }

  const drafts: Draft[] = [];
  for (const metric of metrics) {
    if (gbMeta(metric).enabled === false) continue;
    const tags = tagsOf(metric);
    if (matches(opts.exclude, metric.name, tags)) continue;
    const used = modelsOf(metric);
    if (
      opts.select?.length &&
      !matches(opts.select, metric.name, tags) &&
      !used.some((m) => matches(opts.select, m.name, tagsOf(m)))
    ) {
      continue;
    }
    const blocked = used.filter(modelBlocked);
    if (blocked.length) {
      if (blocked.length < used.length) {
        warnings.push({
          level: "skipped",
          resource: `metric ${metric.name}`,
          message: `depends on semantic model "${blocked[0].name}", which is excluded`,
        });
      }
      continue;
    }
    try {
      const out = metricDraft(metric);
      // Fields the sync owns are always sent, so removing them in dbt
      // removes them in GrowthBook (bulk updates keep omitted fields).
      out.data.description = metric.description ?? "";
      out.data.tags = tags;
      if (out.data.metricType !== "funnel" && !out.data.windowSettings) {
        out.data.windowSettings = { type: "none" };
      }
      Object.assign(out.data, omit(gbMeta(metric), ["enabled"]));
      drafts.push({ metric, ...out });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      warnings.push({
        level: "skipped",
        resource: `metric ${metric.name}`,
        message: e.message,
      });
    }
  }

  // Group usages by (model, time dimension); within a group, keep only the
  // maximal join sets and put each usage on the smallest table that covers it.
  const groups = new Map<string, Usage[]>();
  for (const d of drafts) {
    for (const r of d.refs) {
      const key = `${r.usage.model.name}\n${r.usage.timeDim}`;
      groups.set(key, [...(groups.get(key) ?? []), r.usage]);
    }
  }
  const tables = new Map<string, TableDraft>();
  for (const group of groups.values()) {
    const { model, timeDim } = group[0];
    const sets = [
      ...new Set(
        group.map((u) => [...u.joins.keys()].sort().join(",")).filter((s) => s),
      ),
    ].map((s) => s.split(","));
    const maximal = sets.filter(
      (s) =>
        !sets.some((o) => o.length > s.length && s.every((e) => o.includes(e))),
    );
    for (const u of group) {
      const own = [...u.joins.keys()];
      const chosen = own.length
        ? maximal
            .filter((m) => own.every((e) => m.includes(e)))
            .sort((a, b) => a.length - b.length)[0]
        : [];
      const parts = [model.name];
      if (timeDim !== model.defaults?.agg_time_dimension) parts.push(timeDim);
      u.factTableId = [...parts, ...chosen].join("__");
      let t = tables.get(u.factTableId);
      if (!t) {
        t = {
          id: u.factTableId,
          model,
          timeDim,
          joins: new Map(),
          columns: new Map(),
        };
        tables.set(u.factTableId, t);
      }
      for (const [entity, j] of u.joins) {
        const tj = t.joins.get(entity) ?? { ...j, dims: new Set<string>() };
        j.dims.forEach((dim) => tj.dims.add(dim));
        t.joins.set(entity, tj);
      }
      for (const c of u.columns) {
        if (!t.columns.has(c.column)) t.columns.set(c.column, c);
      }
    }
  }

  const factTables: BulkImportPayload["factTables"] = [];
  const failedTables = new Set<string>();
  for (const t of tables.values()) {
    const model = t.model;
    try {
      const rel = model.node_relation?.relation_name;
      if (!rel) {
        throw new Unsupported(
          `semantic model "${model.name}" has no relation_name (is it materialized?)`,
        );
      }
      const td = findDim(model, t.timeDim);
      const tsCol = td?.expr ?? t.timeDim;
      if (!td || td.type !== "time" || !isIdent(tsCol)) {
        throw new Unsupported(
          `agg_time_dimension "${t.timeDim}" must be a time dimension on a plain column`,
        );
      }
      // Measure columns carry inferred types; everything else is left for detection.
      const columns = new Map(t.columns);
      const declare = (
        column: string,
        datatype: FactTableColumn["datatype"],
      ) => {
        if (!columns.has(column)) columns.set(column, { column, datatype });
      };
      declare(tsCol, "date");
      const userIdTypes: string[] = [];
      const userIdColumns: Record<string, string> = {};
      for (const e of model.entities ?? []) {
        const idType = opts.entities?.[e.name] ?? e.name;
        if (opts.idTypes && !opts.idTypes.includes(idType)) continue;
        const col = e.expr ?? e.name;
        if (!isIdent(col)) {
          warnings.push({
            level: "note",
            resource: `fact table ${t.id}`,
            message: `entity "${e.name}" is an expression and cannot be an identifier column`,
          });
          continue;
        }
        userIdTypes.push(idType);
        if (col !== idType) userIdColumns[idType] = col;
        declare(col, "");
      }
      if (!userIdTypes.length) {
        throw new Unsupported(
          `no entity on "${model.name}" maps to a Data Source identifier type (use --entities)`,
        );
      }
      for (const d of model.dimensions ?? []) {
        const col = d.expr ?? d.name;
        if (isIdent(col)) declare(col, "");
      }

      let sql = `SELECT * FROM ${rel}`;
      const joined = [...t.joins.keys()].sort();
      if (joined.length) {
        const selects = ["t.*"];
        const joins: string[] = [];
        for (const entity of joined) {
          const j = t.joins.get(entity);
          const rel2 = j?.target.node_relation?.relation_name;
          if (!j || !rel2) {
            throw new Unsupported(
              `semantic model "${j?.target.name}" has no relation_name`,
            );
          }
          // The joined side is a subquery so its expressions can't collide
          // with same-named base columns, and every exposed column is prefixed.
          const alias = `j_${entity}`;
          let key = `${entity}__key`;
          while (j.dims.has(key.slice(entity.length + 2))) key += "_";
          const inner = [`${j.pk.expr ?? j.pk.name} AS ${key}`];
          for (const dim of [...j.dims].sort()) {
            const d = findDim(j.target, dim);
            if (!d) continue;
            const col = `${entity}__${dim}`;
            inner.push(`${d.expr ?? d.name} AS ${col}`);
            selects.push(`${alias}.${col}`);
            declare(col, "");
          }
          joins.push(
            `LEFT JOIN (SELECT ${inner.join(", ")} FROM ${rel2}) ${alias} ON ${qualify("t", j.fk.expr ?? j.fk.name)} = ${alias}.${key}`,
          );
        }
        sql = `SELECT ${selects.join(", ")} FROM ${rel} t ${joins.join(" ")}`;
      }

      const label = model.label ?? model.name;
      const data: FactTableData = {
        name: joined.length ? `${label} + ${joined.join(" + ")}` : label,
        datasource: opts.datasource,
        userIdTypes,
        sql,
        timestampColumn: tsCol,
        columns: [...columns.values()],
      };
      if (Object.keys(userIdColumns).length) data.userIdColumns = userIdColumns;
      data.description = model.description ?? "";
      data.tags = tagsOf(model);
      Object.assign(data, omit(gbMeta(model), ["enabled"]));
      factTables.push({ id: t.id, data });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      failedTables.add(t.id);
      warnings.push({
        level: "skipped",
        resource: `fact table ${t.id}`,
        message: e.message,
      });
    }
  }

  const factMetrics: BulkImportPayload["factMetrics"] = [];
  const usedTables = new Set<string>();
  for (const d of drafts) {
    const name = d.metric.name;
    const bad = d.refs.find((r) => failedTables.has(r.usage.factTableId));
    if (bad) {
      warnings.push({
        level: "skipped",
        resource: `metric ${name}`,
        message: `depends on fact table "${bad.usage.factTableId}", which was skipped`,
      });
      continue;
    }
    // First declaration of a column wins; a metric needing a different type
    // for the same column (sum vs count_distinct) would be rejected by the API.
    const conflict = d.refs
      .flatMap((r) =>
        r.usage.columns.map((c) => ({
          c,
          stored: tables.get(r.usage.factTableId)?.columns.get(c.column),
        })),
      )
      .find(({ c, stored }) => stored && stored.datatype !== c.datatype);
    if (conflict) {
      warnings.push({
        level: "skipped",
        resource: `metric ${name}`,
        message: `column "${conflict.c.column}" is used as ${conflict.c.datatype} here but ${conflict.stored?.datatype} by another metric on the same fact table`,
      });
      continue;
    }
    for (const r of d.refs) {
      r.ref.factTableId = r.usage.factTableId;
      usedTables.add(r.usage.factTableId);
    }
    factMetrics.push({ id: name, data: d.data });
  }

  // Plain dbt models annotated with meta.growthbook in GrowthBook's own vocabulary.
  const plainTables = new Set<string>();
  for (const node of values(manifest.nodes)) {
    if (node.resource_type !== "model" || modelsByName.has(node.name)) continue;
    const meta = gbMeta(node);
    if (!Array.isArray(meta.userIdTypes)) continue;
    const tags = tagsOf(node);
    if (meta.enabled === false || matches(opts.exclude, node.name, tags))
      continue;
    const modelSelected =
      !opts.select?.length || matches(opts.select, node.name, tags);
    const entries = (Array.isArray(meta.metrics) ? meta.metrics : []).filter(
      (m) => {
        const id = isRecord(m) && typeof m.id === "string" ? m.id : null;
        if (id === null) return modelSelected;
        if (matches(opts.exclude, id, [])) return false;
        return modelSelected || matches(opts.select, id, []);
      },
    );
    if (!modelSelected && !entries.length) continue;
    if (!node.relation_name) {
      warnings.push({
        level: "skipped",
        resource: `fact table ${node.name}`,
        message: "model has no relation_name (is it materialized?)",
      });
      continue;
    }
    const data: FactTableData = {
      name: node.name,
      datasource: opts.datasource,
      userIdTypes: meta.userIdTypes.filter(
        (t): t is string => typeof t === "string",
      ),
      sql: `SELECT * FROM ${node.relation_name}`,
      timestampColumn: "timestamp",
      columns: [],
    };
    Object.assign(data, omit(meta, ["enabled", "metrics", "userIdTypes"]));
    // The API needs the timestamp and identifier columns declared up front;
    // everything else is detected from the SQL.
    const columns = new Map<string, FactTableColumn>();
    for (const c of Array.isArray(data.columns) ? data.columns : []) {
      if (isRecord(c) && typeof c.column === "string") {
        columns.set(c.column, c as FactTableColumn);
      }
    }
    const declare = (column: string, datatype: FactTableColumn["datatype"]) => {
      if (!columns.has(column)) columns.set(column, { column, datatype });
    };
    if (typeof data.timestampColumn !== "string")
      data.timestampColumn = "timestamp";
    declare(data.timestampColumn, "date");
    const idColumns = isRecord(data.userIdColumns) ? data.userIdColumns : {};
    for (const idType of data.userIdTypes) {
      const col = idColumns[idType];
      declare(typeof col === "string" ? col : idType, "");
    }
    data.columns = [...columns.values()];
    factTables.push({ id: node.name, data });
    plainTables.add(node.name);
    for (const m of entries) {
      if (
        !isRecord(m) ||
        typeof m.id !== "string" ||
        typeof m.name !== "string" ||
        typeof m.metricType !== "string"
      ) {
        warnings.push({
          level: "skipped",
          resource: `fact table ${node.name}`,
          message:
            "a meta.growthbook.metrics entry needs id, name and metricType",
        });
        continue;
      }
      const metric: FactMetricData = { name: m.name, metricType: m.metricType };
      Object.assign(metric, omit(m, ["id"]));
      for (const side of ["numerator", "denominator"] as const) {
        const ref = metric[side];
        if (isRecord(ref) && typeof ref.factTableId !== "string") {
          metric[side] = { ...ref, factTableId: node.name };
        }
      }
      factMetrics.push({ id: m.id, data: metric });
    }
  }

  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);
  return {
    payload: {
      defaultManagedBy: "dbt",
      factTables: factTables
        .filter((t) => usedTables.has(t.id) || plainTables.has(t.id))
        .sort(byId),
      factMetrics: factMetrics.sort(byId),
    },
    warnings,
  };
}
