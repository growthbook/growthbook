import { parseWarehouseDate } from "shared/dates";
import type { FactMetricInterface } from "shared/types/fact-table";
import { datasetHasValues } from "../../../validators/product-analytics";
import type {
  ExplorationConfig,
  ProductAnalyticsResultRow,
  ProductAnalyticsValue,
  ShowAs,
} from "../../../validators/product-analytics";
import {
  configHasPopulation,
  getDraftOrSavedMetric,
  getShowAsChoice,
} from "./show-as";
import { getSharedUnit } from "./units";

// ---- showAs inference & applicability ---------------------------------------
//
// These helpers are shared between the frontend Explorer UI and the backend
// product analytics AI agent so that both surfaces resolve `showAs` and the
// effective per-metric value identically. Keeping them in one place prevents
// drift between what the chart renders and what the agent sees in its CSV.

/**
 * Value-axis title when no custom `valueAxisLabel` is set. Empty unless every
 * value on the axis renders the same way (see `sharedShowAs`).
 */
export function getDefaultValueAxisName({
  sharedShowAs,
  sharedUnit,
}: ExplorationRenderOpts): string {
  if (sharedShowAs === null) return "";
  if (sharedShowAs === "total") return "Total";
  if (sharedShowAs === "percent_of_population") return "% of Population";
  return sharedUnit ? `Per ${sharedUnit}` : "Per unit";
}

/**
 * The value-axis title the chart shows: the custom label when one is set (an
 * empty one hides the title), otherwise the default.
 */
export function getValueAxisName(
  config: ExplorationConfig | null,
  renderOpts: ExplorationRenderOpts,
): string {
  return (
    config?.chartSettings?.valueAxisLabel?.trim() ??
    getDefaultValueAxisName(renderOpts)
  );
}

/** A value's display name; "Metric N" when it was saved blank. */
function getValueName(value: ProductAnalyticsValue, index: number): string {
  return value.name.trim() ? value.name : `Metric ${index + 1}`;
}

/**
 * A value's name annotated with how it renders, e.g. "Revenue (per user_id)"
 * or "Revenue (total)". Parenthesized so it reads as a note, not part of a
 * name that may already say "per user".
 */
function getAnnotatedName(
  value: ProductAnalyticsValue,
  index: number,
  showAs: ShowAs,
  sharedUnit: string | null,
): string {
  const name = getValueName(value, index);
  if (showAs === "total") return `${name} (total)`;
  if (showAs === "percent_of_population") return `${name} (% of Population)`;
  const unit =
    ("unit" in value && typeof value.unit === "string" ? value.unit : null) ||
    sharedUnit ||
    "unit";
  return `${name} (per ${unit})`;
}

/**
 * Computes the effective numeric value for a single metric result cell, given
 * the effective showAs and whether the underlying metric is a ratio. Ratios
 * always render as N/D regardless of showAs. Without render settings (no
 * dataset value at that index) the raw numerator is used.
 *
 * `populationCount` is the result row's population member count, present only
 * when the request has a population.
 */
export function getEffectiveMetricValue(
  v: { numerator: number | null; denominator: number | null },
  opts: Pick<ValueRenderOpts, "showAs" | "isRatio"> | undefined,
  populationCount?: number,
): number {
  const num = v.numerator ?? 0;
  if (opts?.isRatio) {
    return v.denominator ? num / v.denominator : num;
  }
  if (opts?.showAs === "per_unit") {
    return v.denominator ? num / v.denominator : num;
  }
  if (opts?.showAs === "percent_of_population") {
    if (!populationCount) return 0;
    const shareOfPopulation = num / populationCount;
    return shareOfPopulation * 100;
  }
  return num;
}

/** Whether a dataset value is a ratio metric. Only metric values can be. */
export function isRatioValue(
  value: ProductAnalyticsValue,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): boolean {
  return (
    value.type === "metric" &&
    getDraftOrSavedMetric(value, getFactMetricById)?.metricType === "ratio"
  );
}

/** How one dataset value renders. */
export type ValueRenderOpts = {
  showAs: ShowAs;
  isRatio: boolean;
  /** Chart legend and tooltip name. */
  seriesName: string;
};

/** How a config's values render: each value, plus what they share. */
export type ExplorationRenderOpts = {
  /** Index-aligned with `dataset.values`; empty for funnels and journeys. */
  values: ValueRenderOpts[];
  /** The mode every value renders in; null when modes differ or no value offers a choice. */
  sharedShowAs: ShowAs | null;
  /** Some values render as totals and others per unit. */
  modesAreMixed: boolean;
  /** See `getSharedUnit`. */
  sharedUnit: string | null;
};

const NO_VALUES_RENDER_OPTS: ExplorationRenderOpts = {
  values: [],
  sharedShowAs: null,
  modesAreMixed: false,
  sharedUnit: null,
};

/**
 * Resolves how every value renders, once. The chart, the result table, the
 * axis title and the agent's CSV all read the result.
 */
export function getExplorationRenderOpts(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ExplorationRenderOpts {
  if (!datasetHasValues(config?.dataset)) return NO_VALUES_RENDER_OPTS;
  const { values } = config.dataset;
  const hasPopulation = configHasPopulation(config);
  const choices = values.map((v) =>
    getShowAsChoice(v, config.showAs, getFactMetricById, hasPopulation),
  );
  const someValueOffersShowAs = choices.some(
    (choice) => choice.options.length > 0,
  );
  const modes = new Set(choices.map((choice) => choice.showAs));
  const sharedShowAs =
    someValueOffersShowAs && modes.size === 1 ? [...modes][0] : null;
  const modesAreMixed = someValueOffersShowAs && sharedShowAs === null;
  const sharedUnit = getSharedUnit(config, getFactMetricById);

  // Annotate series names when the axis title can't tell readers how the
  // values are calculated.
  const hasCustomAxisTitle = config.chartSettings?.valueAxisLabel !== undefined;
  const axisTitleNamesTheUnit = !hasCustomAxisTitle && sharedUnit !== null;
  const annotateNames =
    modesAreMixed ||
    (sharedShowAs === "per_unit" && !axisTitleNamesTheUnit) ||
    (sharedShowAs === "percent_of_population" && hasCustomAxisTitle);

  return {
    values: values.map((v, i) => ({
      showAs: choices[i].showAs,
      isRatio: isRatioValue(v, getFactMetricById),
      seriesName: annotateNames
        ? getAnnotatedName(v, i, choices[i].showAs, sharedUnit)
        : getValueName(v, i),
    })),
    sharedShowAs,
    modesAreMixed,
    sharedUnit,
  };
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
    }
  | {
      /** Each row's Population member count, last when the chart has one. */
      kind: "populationCount";
      key: string;
      label: string;
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
  renderOpts: ExplorationRenderOpts,
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
  if (!datasetHasValues(config?.dataset)) return cols;
  const { values } = config.dataset;
  if (values.length === 0) return cols;

  const { modesAreMixed, sharedUnit } = renderOpts;

  values.forEach((v, metricIndex) => {
    const name = getValueName(v, metricIndex);
    const { isRatio, showAs } = renderOpts.values[metricIndex];
    if (isRatio) {
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

    // A plain header means total, unless other modes' columns sit beside it.
    const annotate =
      showAs === "per_unit" ||
      showAs === "percent_of_population" ||
      modesAreMixed;
    const singleLabel = annotate
      ? getAnnotatedName(v, metricIndex, showAs, sharedUnit)
      : name;
    cols.push({
      kind: "metric",
      key: `__metric_${metricIndex}__`,
      label: singleLabel,
      metricIndex,
      sub: "single",
    });
  });

  if (configHasPopulation(config)) {
    cols.push({
      kind: "populationCount",
      key: "__population_count__",
      label: "Population count",
    });
  }

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
    populationCount?: number;
  },
  col: ExplorationColumn,
  renderOpts: ExplorationRenderOpts,
): string | number | null {
  if (col.kind === "dimension") {
    return row.dimensions[col.dimIndex] ?? null;
  }
  if (col.kind === "populationCount") {
    return row.populationCount ?? null;
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
  return getEffectiveMetricValue(
    v,
    renderOpts.values[col.metricIndex],
    row.populationCount,
  );
}

function getRowTotal(
  row: ProductAnalyticsResultRow,
  opts: ExplorationRenderOpts,
): number {
  return (row.values ?? []).reduce(
    (sum, v, i) =>
      sum + getEffectiveMetricValue(v, opts.values[i], row.populationCount),
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
