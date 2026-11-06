import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { parseWarehouseDate } from "shared/dates";
import { omit } from "lodash";
import type {
  FactMetricInterface,
  FactMetricType,
  FactTableColumnType,
} from "shared/types/fact-table";
import { datasetHasValues } from "../../../validators/product-analytics";
import type {
  ExplorationConfig,
  ExplorationDataset,
  MetricValue,
  ProductAnalyticsResultRow,
  ProductAnalyticsValue,
  ShowAs,
} from "../../../validators/product-analytics";

/**
 * Narrows an already-classified warehouse column type to the smaller set an
 * exploration dataset can hold. `json`, `binary` and the undetected `""` have
 * no exploration equivalent.
 */
export function mapColumnTypeToExplorationType(
  datatype: FactTableColumnType | undefined,
): "string" | "number" | "date" | "boolean" | "other" {
  switch (datatype) {
    case "string":
    case "number":
    case "date":
    case "boolean":
      return datatype;
    case "json":
    case "binary":
    case "other":
    case "":
    case undefined:
      return "other";
  }
}

// Checked first, since inner types like `ARRAY<INT64>` would match a primitive
const COMPLEX_TYPE =
  /^(struct|array|map|jsonb?|variant|object|tuple|row|record|super|nested|vector|range)\b/;

export function mapDatabaseTypeToEnum(
  dbType: string,
): "string" | "number" | "date" | "boolean" | "other" {
  const lowerType = dbType.toLowerCase();

  // ClickHouse wraps the real type, as in `LowCardinality(Nullable(String))`
  if (
    COMPLEX_TYPE.test(lowerType.replace(/^((nullable|lowcardinality)\()+/, ""))
  ) {
    return "other";
  }

  if (
    lowerType.includes("int") ||
    // Snowflake and Oracle report every fixed-point column as NUMBER
    lowerType.includes("number") ||
    lowerType.includes("numeric") ||
    lowerType.includes("decimal") ||
    lowerType.includes("float") ||
    lowerType.includes("double") ||
    lowerType.includes("real")
  ) {
    return "number";
  }

  if (lowerType.includes("date") || lowerType.includes("time")) {
    return "date";
  }

  if (lowerType.includes("bool")) {
    return "boolean";
  }

  if (
    lowerType.includes("char") ||
    lowerType.includes("text") ||
    lowerType.includes("string")
  ) {
    return "string";
  }

  return "other";
}

/** True when a dataset timestamp field names a real column. Empty string, null, and undefined are all "unset". */
export function hasTimestampColumn(
  timestampColumn: string | null | undefined,
): timestampColumn is string {
  return typeof timestampColumn === "string" && timestampColumn.length > 0;
}

/**
 * SQL and data_source datasets can omit a timestamp (SQL on purpose; data_source
 * while the user is still picking a column). Other dataset types always have one.
 */
export function hasTimeAxis(
  dataset: Pick<ExplorationDataset, "type"> & {
    timestampColumn?: string | null;
  },
): boolean {
  if (dataset.type === "sql" || dataset.type === "data_source") {
    return hasTimestampColumn(dataset.timestampColumn);
  }
  return true;
}

/** Default product analytics config used for new blocks and Explorer initial state. */
export const DEFAULT_EXPLORE_STATE: ExplorationConfig = {
  type: "metric",
  dataset: {
    type: "metric",
    values: [],
  },
  datasource: "",
  dimensions: [
    {
      dimensionType: "date",
      column: "date",
      dateGranularity: "auto",
    },
  ],
  chartType: "line",
  dateRange: {
    predefined: "last30Days",
    lookbackValue: 30,
    lookbackUnit: "day",
    startDate: null,
    endDate: null,
  },
};

export type ProductAnalyticsExplorationBlockType =
  | "metric-exploration"
  | "fact-table-exploration"
  | "data-source-exploration"
  | "sql-exploration"
  | "funnel-exploration";

export function getInitialConfigByBlockType(
  blockType: ProductAnalyticsExplorationBlockType,
  datasourceId: string,
): ExplorationConfig {
  switch (blockType) {
    case "metric-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        datasource: datasourceId,
      };
    case "fact-table-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "fact_table",
        dataset: {
          type: "fact_table",
          values: [],
          factTableId: null,
        },
        datasource: datasourceId,
      };
    case "data-source-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "data_source",
        dataset: {
          type: "data_source",
          values: [],
          table: "",
          path: "",
          timestampColumn: "",
          columnTypes: {},
        },
        datasource: datasourceId,
      };
    case "sql-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "sql",
        dimensions: [],
        chartType: "bar",
        dataset: {
          type: "sql",
          values: [],
          sql: "",
          timestampColumn: null,
          columnTypes: {},
        },
        datasource: datasourceId,
      };
    case "funnel-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "funnel",
        dataset: {
          type: "funnel",
          unit: null,
          steps: [],
        },
        datasource: datasourceId,
      };
    default:
      throw new Error(`Invalid block type: ${blockType}`);
  }
}

// `~` is not in either base64 alphabet, so its presence unambiguously marks the
// compressed format and lets us keep decoding links shared before it existed.
// It is also unreserved in a URL, so it survives without percent-encoding.
const COMPRESSED_CONFIG_PREFIX = "~";
const MAX_ENCODED_CONFIG_LENGTH = 16 * 1024;
const MAX_DECODED_CONFIG_BYTES = 100 * 1024;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunked because String.fromCharCode(...bytes) overflows the call stack on
  // the payload sizes that made this compression necessary.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeExplorationConfig(config: ExplorationConfig): string {
  const deflated = deflateSync(strToU8(JSON.stringify(config)), { level: 9 });
  return COMPRESSED_CONFIG_PREFIX + bytesToBase64Url(deflated);
}

function inflateExplorationConfig(deflated: Uint8Array): Uint8Array {
  // Streaming Inflate still grows an internal buffer before ondata; `out` is
  // what caps allocation.
  const out = new Uint8Array(MAX_DECODED_CONFIG_BYTES + 1);
  const inflated = inflateSync(deflated, { out });
  if (inflated.length > MAX_DECODED_CONFIG_BYTES) {
    throw new Error("Exploration config is too large");
  }
  return inflated;
}

/**
 * Parses an encoded `?config=` payload into untrusted JSON. Callers validate the
 * result. Throws on a malformed payload.
 */
export function decodeExplorationConfigJson(encoded: string): unknown {
  if (encoded.length > MAX_ENCODED_CONFIG_LENGTH) {
    throw new Error("Exploration config is too large");
  }
  if (encoded.startsWith(COMPRESSED_CONFIG_PREFIX)) {
    const deflated = base64UrlToBytes(
      encoded.slice(COMPRESSED_CONFIG_PREFIX.length),
    );
    return JSON.parse(strFromU8(inflateExplorationConfig(deflated)));
  }
  const json = decodeURIComponent(atob(encoded));
  if (json.length > MAX_DECODED_CONFIG_BYTES) {
    throw new Error("Exploration config is too large");
  }
  return JSON.parse(json);
}

// ---- showAs inference & applicability ---------------------------------------
//
// These helpers are shared between the frontend Explorer UI and the backend
// product analytics AI agent so that both surfaces resolve `showAs` and the
// effective per-metric value identically. Keeping them in one place prevents
// drift between what the chart renders and what the agent sees in its CSV.

// Classifies a metric for chart-mixing rules.
// - "ratio"    -> always renders as N/D, can't be mixed with other classes
// - "quantile" -> percentile value, can't be mixed with other classes
// - "standard" -> mean/proportion/retention/dailyParticipation, mix freely
// - "unknown"  -> unselected metric or metric id we couldn't resolve
export type MetricMixClass = "ratio" | "quantile" | "standard" | "unknown";

export function getMetricMixClass(
  metricType: string | null | undefined,
): MetricMixClass {
  if (metricType === "ratio") return "ratio";
  if (metricType === "quantile") return "quantile";
  if (
    metricType === "mean" ||
    metricType === "proportion" ||
    metricType === "retention" ||
    metricType === "dailyParticipation"
  ) {
    return "standard";
  }
  return "unknown";
}

/**
 * How a value renders when its metric type offers no Show as options: its raw
 * value. Ratios ignore it and always render numerator / denominator.
 */
const NO_SHOW_AS_CHOICE_DEFAULT: ShowAs = "total";

/**
 * The Show as options each metric type offers, in display order. A type that
 * isn't listed offers no choice and renders as `NO_SHOW_AS_CHOICE_DEFAULT`.
 *
 * - mean: the numerator sums each unit's value, so dividing by the unit count
 *   gives a real per-unit average.
 * - proportion / retention / dailyParticipation: not listed. They emit one row
 *   per qualifying unit, so the unit count equals the numerator and per unit
 *   would always be ~1.
 * - ratio / quantile: not listed. Ratios already divide by their own
 *   denominator, and quantiles emit no denominator.
 */
const SHOW_AS_OPTIONS_BY_METRIC_TYPE: Partial<
  Record<FactMetricType, readonly ShowAs[]>
> = {
  mean: ["total", "per_unit"],
};

/** The Show as options a metric type offers; empty when it offers none. */
export function getShowAsOptions(
  metricType: FactMetricType | undefined,
): readonly ShowAs[] {
  return (metricType && SHOW_AS_OPTIONS_BY_METRIC_TYPE[metricType]) ?? [];
}

/** How one dataset value renders, and which Show as options it offers. */
export type ShowAsChoice = {
  /** Empty when the value's metric type offers no choice. */
  options: readonly ShowAs[];
  showAs: ShowAs;
};

const NO_SHOW_AS_CHOICE: ShowAsChoice = {
  options: [],
  showAs: NO_SHOW_AS_CHOICE_DEFAULT,
};

/** The parts of a metric definition that decide how its values can render. */
type ShowAsMetric = Pick<FactMetricInterface, "metricType" | "numerator">;

/**
 * The definition a metric value renders: its unsaved draft in the metric
 * editor preview, otherwise the saved metric. Null while definitions load.
 */
function getDraftOrSavedMetric(
  value: MetricValue,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ShowAsMetric | null {
  return value.draftMetric ?? getFactMetricById(value.metricId);
}

/**
 * The default `showAs` for a value without an explicit choice: `per_unit` for
 * mean metrics whose total is incoherent — numerator aggregation `max` (a sum
 * of per-unit maxes has no interpretation) or `count distinct` (double-counts
 * values shared across units) — otherwise `total`.
 */
export function inferShowAs(metric: ShowAsMetric | null): ShowAs {
  if (metric?.metricType === "mean") {
    const agg = metric.numerator?.aggregation ?? "sum";
    return agg === "max" || agg === "count distinct" ? "per_unit" : "total";
  }
  return NO_SHOW_AS_CHOICE_DEFAULT;
}

/**
 * Returns the showAs options and selected mode for a metric value.
 *
 */
export function getShowAsChoice(
  value: ProductAnalyticsValue,
  legacyShowAs: ShowAs | undefined,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ShowAsChoice {
  if (value.type !== "metric") return NO_SHOW_AS_CHOICE;
  const metric = getDraftOrSavedMetric(value, getFactMetricById);
  const options = getShowAsOptions(metric?.metricType);
  if (!options.length) return NO_SHOW_AS_CHOICE;
  const showAs =
    [value.showAs, legacyShowAs, inferShowAs(metric)].find(
      (candidate): candidate is ShowAs =>
        candidate !== undefined && options.includes(candidate),
    ) ?? options[0];
  return { options, showAs };
}

/**
 * Write-time counterpart to `getShowAsChoice`: moves the deprecated
 * config-level `showAs` onto the metric values that offer it as an option and
 * strips `showAs` that isn't one of the value's options, so a stored config
 * never claims a mode that won't render. Values whose metric hasn't resolved
 * yet keep theirs until their options are known. Call it alongside the other
 * write-time normalizers (validateDimensions, fillMissingUnits).
 *
 * Returns the same reference when nothing changed so callers can use identity
 * comparisons to avoid unnecessary re-renders.
 */
export function normalizeShowAs<T extends ExplorationConfig>(
  config: T,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): T {
  // Other dataset types don't support showAs.
  if (config.dataset.type !== "metric") return config;

  const legacyShowAs = config.showAs;
  const hasLegacyShowAs = legacyShowAs !== undefined;
  let valuesChanged = false;

  const values = config.dataset.values.map((value): MetricValue => {
    const showAs = value.showAs ?? legacyShowAs;
    if (showAs === undefined) return value;

    const metric = getDraftOrSavedMetric(value, getFactMetricById);
    // No metric yet (not picked, or definitions still loading): its options
    // are unknown, so keep the choice rather than lose it.
    const optionsAreUnknown = metric === null;
    const metricOffersShowAs =
      metric !== null && getShowAsOptions(metric.metricType).includes(showAs);
    const keepShowAs = optionsAreUnknown || metricOffersShowAs;
    const alreadyStored = value.showAs === showAs;

    if (keepShowAs && alreadyStored) return value;
    valuesChanged = true;
    if (keepShowAs) return { ...value, showAs };
    return omit(value, "showAs");
  });

  if (!hasLegacyShowAs && !valuesChanged) return config;
  return {
    ...omit(config, "showAs"),
    dataset: { ...config.dataset, values },
  } as T;
}

/**
 * Returns the shared unit name when all values in a metric dataset agree on a
 * single unit, otherwise null. Used to label "Per <unit>" in UI controls and
 * the agent's CSV output.
 */
export function getSharedUnit(config: ExplorationConfig | null): string | null {
  if (!config?.dataset || config.dataset.type !== "metric") return null;
  const units = config.dataset.values
    .map((v) => v.unit)
    .filter((u): u is string => !!u);
  if (units.length === 0) return null;
  const first = units[0];
  return units.every((u) => u === first) ? first : null;
}

/**
 * Value-axis title when no custom `valueAxisLabel` is set. Empty unless every
 * value on the axis renders the same way (see `getSharedShowAs`).
 */
export function getDefaultValueAxisName(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string {
  if (!datasetHasValues(config?.dataset)) return "";
  const choices = config.dataset.values.map((v) =>
    getShowAsChoice(v, config.showAs, getFactMetricById),
  );
  const sharedShowAs = getSharedShowAs(choices);
  if (sharedShowAs === null) return "";
  if (sharedShowAs === "total") return "Total";
  const sharedUnit = getSharedUnit(config);
  return sharedUnit ? `Per ${sharedUnit}` : "Per unit";
}

/**
 * The mode every value renders in, counting values without Show as options as
 * the `total` they render. Null when modes differ — e.g. a per-unit mean next
 * to a proportion, which plots raw counts — or when no value offers options,
 * since Total/Per unit then describes no choice.
 */
function getSharedShowAs(choices: ShowAsChoice[]): ShowAs | null {
  if (!choices.some((choice) => choice.options.length > 0)) return null;
  const modes = new Set(choices.map((choice) => choice.showAs));
  return modes.size === 1 ? [...modes][0] : null;
}

/**
 * A value's name annotated with how it renders, e.g. "Revenue (per user_id)"
 * or "Revenue (total)". Parenthesized so it reads as a note, not part of a
 * name that may already say "per user".
 */
function getAnnotatedName(
  value: ProductAnalyticsValue,
  showAs: ShowAs,
  sharedUnit: string | null,
): string {
  if (showAs === "total") return `${value.name} (total)`;
  const unit =
    ("unit" in value && typeof value.unit === "string" ? value.unit : null) ||
    sharedUnit ||
    "unit";
  return `${value.name} (per ${unit})`;
}

/**
 * Whether chart series names (legend and tooltip) need annotating because the
 * default value-axis title can't say how the values render:
 * - modes are mixed on the axis (no title): every value is annotated,
 *   including values without Show as options, which render as totals;
 * - every value is per unit but the title doesn't name one unit (units
 *   differ, or a custom title is set): each gets "(per {unit})".
 * When every value is a total, names stay plain.
 */
function shouldAnnotateSeriesNames(
  config: ExplorationConfig,
  choices: ShowAsChoice[],
): boolean {
  const sharedShowAs = getSharedShowAs(choices);
  const modesAreMixed =
    sharedShowAs === null &&
    choices.some((choice) => choice.options.length > 0);
  const axisTitleNamesUnit =
    config.chartSettings?.valueAxisLabel === undefined &&
    getSharedUnit(config) !== null;
  return modesAreMixed || (sharedShowAs === "per_unit" && !axisTitleNamesUnit);
}

/**
 * Computes the effective numeric value for a single metric result cell, given
 * the effective showAs and whether the underlying metric is a ratio. Ratios
 * always render as N/D regardless of showAs. Without render settings (no
 * dataset value at that index) the raw numerator is used.
 */
export function getEffectiveMetricValue(
  v: { numerator: number | null; denominator: number | null },
  opts: Pick<ValueRenderOpts, "showAs" | "isRatio"> | undefined,
): number {
  const num = v.numerator ?? 0;
  if (opts?.isRatio) {
    return v.denominator ? num / v.denominator : num;
  }
  if (opts?.showAs === "per_unit") {
    return v.denominator ? num / v.denominator : num;
  }
  return num;
}

/**
 * Build an array of `isRatio` flags indexed by dataset value position.
 * Only metric datasets can contain ratio values; fact_table and data_source
 * datasets never do.
 */
export function getIsRatioByIndex(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): boolean[] {
  if (!config?.dataset || config.dataset.type !== "metric") return [];
  return config.dataset.values.map(
    (v) => getDraftOrSavedMetric(v, getFactMetricById)?.metricType === "ratio",
  );
}

/** How one dataset value renders. */
export type ValueRenderOpts = {
  showAs: ShowAs;
  isRatio: boolean;
  /** Chart legend and tooltip name. */
  seriesName: string;
};

/** Render settings per dataset value, index-aligned with `dataset.values`. */
export type ExplorationRenderOpts = ValueRenderOpts[];

/** Empty for datasets without values (funnels, journeys). */
export function getExplorationRenderOpts(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ExplorationRenderOpts {
  if (!datasetHasValues(config?.dataset)) return [];
  const { values } = config.dataset;
  const choices = values.map((v) =>
    getShowAsChoice(v, config.showAs, getFactMetricById),
  );
  const annotateNames = shouldAnnotateSeriesNames(config, choices);
  const sharedUnit = getSharedUnit(config);
  const isRatioByIndex = getIsRatioByIndex(config, getFactMetricById);
  return values.map((v, i) => ({
    showAs: choices[i].showAs,
    // Only metric datasets can hold ratios; other datasets have no flags.
    isRatio: isRatioByIndex[i] ?? false,
    seriesName: annotateNames
      ? getAnnotatedName(v, choices[i].showAs, sharedUnit)
      : v.name,
  }));
}

// ---- Exploration table column schema ----------------------------------------
//
// These helpers produce a canonical column layout + header labels for an
// exploration result, shared between the Explorer result table (React) and
// the AI agent's CSV serializer. Keeping the schema in one place guarantees
// both surfaces show the same set of columns, in the same order, with the
// same meaning — no more drift between "what the chart/table shows" and
// "what the agent sees in its CSV".

export type ExplorationColumn =
  | {
      kind: "dimension";
      key: string;
      label: string;
      dimIndex: number;
    }
  | {
      kind: "metric";
      key: string;
      label: string;
      metricIndex: number;
      /**
       * - "numerator" / "denominator" / "value": the three columns emitted for
       *   ratio metrics (Value = N/D).
       * - "single": one column whose value respects the effective showAs.
       */
      sub: "numerator" | "denominator" | "value" | "single";
    };

/**
 * Compute the human-readable labels used for dimension columns. Date and
 * "Total"-fallback handling matches both the Explorer table and the agent CSV.
 */
function getDimensionLabels(config: ExplorationConfig | null): string[] {
  const labels: string[] = [];
  for (const d of config?.dimensions ?? []) {
    if (d.dimensionType === "date") labels.push("Date");
    else if (d.dimensionType === "dynamic")
      labels.push(d.column ?? "Dimension");
    else if (d.dimensionType === "static") labels.push(d.column);
    else if (d.dimensionType === "slice") labels.push("Slice");
    else labels.push("Dimension");
  }
  if (labels.length === 0) labels.push("Total");
  return labels;
}

/**
 * Build the full column schema for an exploration result: dimension columns
 * followed by metric columns. Ratio metrics expand into three sub-columns
 * (Numerator / Denominator / Value); everything else renders as a single
 * column whose header encodes the effective showAs (e.g. "revenue per
 * user_id" vs "revenue"), so a reader of just the table or CSV can tell at a
 * glance which mode the numbers are in.
 */
export function buildExplorationColumns(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ExplorationColumn[] {
  const cols: ExplorationColumn[] = [];

  // Keys are stable, machine-oriented identifiers that stay unique even when
  // two metrics resolve to the same display label (e.g. "revenue" and
  // "revenue (per user_id)" in per_unit mode). Labels carry the display string.
  const dimLabels = getDimensionLabels(config);
  dimLabels.forEach((label, i) => {
    cols.push({ kind: "dimension", key: `__dim_${i}__`, label, dimIndex: i });
  });

  // Funnel datasets have no `values` — the funnel table builds its own
  // column layout (see useExplorationTableData). Bail out here with only
  // dimension columns so the shared schema doesn't claim a value layout
  // that doesn't exist on the row.
  const values =
    config?.dataset?.type === "funnel" || config?.dataset?.type === "journey"
      ? []
      : (config?.dataset?.values ?? []);
  if (values.length === 0) return cols;

  const isRatio = getIsRatioByIndex(config, getFactMetricById);
  const sharedUnit = getSharedUnit(config);

  values.forEach((v, metricIndex) => {
    const name = v.name;
    if (isRatio[metricIndex]) {
      cols.push({
        kind: "metric",
        key: `__metric_${metricIndex}_numerator__`,
        label: `${name} Numerator`,
        metricIndex,
        sub: "numerator",
      });
      cols.push({
        kind: "metric",
        key: `__metric_${metricIndex}_denominator__`,
        label: `${name} Denominator`,
        metricIndex,
        sub: "denominator",
      });
      cols.push({
        kind: "metric",
        key: `__metric_${metricIndex}_value__`,
        label: `${name} Value`,
        metricIndex,
        sub: "value",
      });
      return;
    }

    // Only per-unit columns are annotated, so a plain header means totals.
    const { showAs } = getShowAsChoice(v, config?.showAs, getFactMetricById);
    const singleLabel =
      showAs === "per_unit"
        ? getAnnotatedName(v, "per_unit", sharedUnit)
        : name;
    cols.push({
      kind: "metric",
      key: `__metric_${metricIndex}__`,
      label: singleLabel,
      metricIndex,
      sub: "single",
    });
  });

  return cols;
}

/**
 * Extract the raw cell value for a given column slot from a result row, using
 * the effective showAs / ratio flags to decide how "single" cells are
 * computed. Returns `null` for missing data, a `number` for metric cells, and
 * a `string | null` for dimension cells. Formatting (decimal places, date
 * strings) is left to each surface to apply.
 */
export function getExplorationCellValue(
  row: {
    dimensions: (string | null)[];
    // Optional because funnel rows carry `steps` instead of `values`. The
    // shared schema for funnels is dimension-only (no metric columns), so
    // values is always undefined for funnel callers and treated as empty.
    values?: { numerator: number | null; denominator: number | null }[];
  },
  col: ExplorationColumn,
  renderOpts: ExplorationRenderOpts,
): string | number | null {
  if (col.kind === "dimension") {
    return row.dimensions[col.dimIndex] ?? null;
  }
  const v = row.values?.[col.metricIndex];
  if (!v) return null;
  if (col.sub === "numerator") return v.numerator;
  if (col.sub === "denominator") return v.denominator;
  if (col.sub === "value") {
    if (v.numerator != null && v.denominator)
      return v.numerator / v.denominator;
    return null;
  }
  if (v.numerator == null) return null;
  return getEffectiveMetricValue(v, renderOpts[col.metricIndex]);
}

function getRowTotal(
  row: ProductAnalyticsResultRow,
  opts: ExplorationRenderOpts,
): number {
  return (row.values ?? []).reduce(
    (sum, v, i) => sum + getEffectiveMetricValue(v, opts[i]),
    0,
  );
}

/** Compute the sum of all metric values grouped by a specific dimension index. */
export function computeDimensionTotals(
  rows: ProductAnalyticsResultRow[],
  dimIndex: number,
  opts: ExplorationRenderOpts,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const key = row.dimensions[dimIndex] ?? "";
    totals[key] = (totals[key] ?? 0) + getRowTotal(row, opts);
  }
  return totals;
}

/** Sum of all metric values grouped by the "group key" (all dimensions after the first). */
function computeGroupTotals(
  rows: ProductAnalyticsResultRow[],
  opts: ExplorationRenderOpts,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const key = row.dimensions.slice(1).join(" - ");
    totals[key] = (totals[key] ?? 0) + getRowTotal(row, opts);
  }
  return totals;
}

/**
 * Sort exploration result rows to match the visual ordering of the chart.
 * - Timeseries: chronological by first dimension (date), then by group total descending.
 * - Bar/cumulative: by first-dimension total descending, then by group total descending.
 */
export function sortExplorationRows(
  rows: ProductAnalyticsResultRow[],
  isTimeseries: boolean,
  opts: ExplorationRenderOpts,
): ProductAnalyticsResultRow[] {
  if (rows.length === 0) return rows;

  const dim0Totals = computeDimensionTotals(rows, 0, opts);
  const groupTotals = computeGroupTotals(rows, opts);

  return [...rows].sort((a, b) => {
    const dim0A = a.dimensions[0] ?? "";
    const dim0B = b.dimensions[0] ?? "";

    if (dim0A !== dim0B) {
      if (isTimeseries) {
        return (
          parseWarehouseDate(dim0A).getTime() -
          parseWarehouseDate(dim0B).getTime()
        );
      }
      return (dim0Totals[dim0B] ?? 0) - (dim0Totals[dim0A] ?? 0);
    }

    const groupA = a.dimensions.slice(1).join(" - ");
    const groupB = b.dimensions.slice(1).join(" - ");
    return (groupTotals[groupB] ?? 0) - (groupTotals[groupA] ?? 0);
  });
}
