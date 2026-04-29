import type { FactMetricInterface } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  ShowAs,
} from "../../../validators/product-analytics";

export function mapDatabaseTypeToEnum(
  dbType: string,
): "string" | "number" | "date" | "boolean" | "other" {
  const lowerType = dbType.toLowerCase();

  if (
    lowerType.includes("int") ||
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
  showAs: "total",
};

export type ProductAnalyticsExplorationBlockType =
  | "metric-exploration"
  | "fact-table-exploration"
  | "data-source-exploration";

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
    default:
      throw new Error(`Invalid block type: ${blockType}`);
  }
}

export function encodeExplorationConfig(config: ExplorationConfig): string {
  return btoa(encodeURIComponent(JSON.stringify(config)));
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
 * True when the per-unit branch of `showAs` produces a meaningful value for
 * this metric type (i.e. the emitted denominator isn't a trivial function of
 * the numerator).
 *
 * - mean: yes. Numerator sums the column across units; denominator counts units
 *   with activity; per_unit = real average per unit.
 * - proportion / retention / dailyParticipation: no. These metrics emit one row
 *   per qualifying unit, so denominator (COUNT of numerator rows) == numerator
 *   and per_unit degenerates to ~1. Only totals make sense for these in PA.
 * - ratio / quantile: N/A, handled separately (ratios self-contain N/D, quantiles
 *   have no denominator emitted).
 * - unknown: assume yes so we don't hide the control while a metric is loading.
 */
export function metricHasMeaningfulPerUnit(
  metricType: string | null | undefined,
): boolean {
  if (!metricType) return true;
  if (metricType === "mean") return true;
  return false;
}

/**
 * True when the chart-level `showAs` toggle is meaningful for this dataset.
 *
 * - Metric datasets: applies when at least one value is a standard metric for
 *   which per-unit rendering is non-degenerate. Ratio/quantile metrics ignore
 *   showAs, and proportion/retention/dailyParticipation collapse per_unit to ~1
 *   in the product-analytics layer (no exposure set → denominator == numerator).
 * - fact_table / data_source datasets: never applies.
 */
export function showAsAppliesTo(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): boolean {
  if (!config?.dataset) return false;
  if (config.dataset.type !== "metric") return false;
  if (config.dataset.values.length === 0) return false;
  const selectedValues = config.dataset.values.filter((v) => !!v.metricId);
  if (selectedValues.length === 0) return false;
  return selectedValues.some((v) => {
    const type = getFactMetricById(v.metricId ?? "")?.metricType;
    const c = getMetricMixClass(type);
    if (c !== "standard" && c !== "unknown") return false;
    return metricHasMeaningfulPerUnit(type);
  });
}

/**
 * Infer a smart default for `showAs` when the user hasn't explicitly chosen one.
 *
 * Rule: default to `per_unit` when any `mean` metric in the dataset would
 * render an incoherent total — specifically, numerator aggregation `max`
 * (sum-of-per-unit-maxes has no interpretation) or `count distinct`
 * (sum-of-per-unit-distinct-counts double-counts values shared across
 * units). In a mixed dataset (e.g. mean+max alongside a proportion), the
 * mean portion would otherwise silently show a mathematically wrong total
 * until the user toggles. Non-mean metrics do not block the default, and
 * everything else falls through to `total`.
 */
export function inferShowAs(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ShowAs {
  if (!showAsAppliesTo(config, getFactMetricById)) return "total";
  if (!config || config.dataset.type !== "metric") return "total";

  const selectedValues = config.dataset.values.filter((v) => !!v.metricId);
  if (selectedValues.length === 0) return "total";
  const anyMeanIsIncoherentAsTotal = selectedValues.some((v) => {
    const m = getFactMetricById(v.metricId ?? "");
    if (m?.metricType !== "mean") return false;
    const agg = m.numerator?.aggregation ?? "sum";
    return agg === "max" || agg === "count distinct";
  });
  return anyMeanIsIncoherentAsTotal ? "per_unit" : "total";
}

/**
 * Resolves the effective showAs for a config: the user's explicit choice when
 * set, otherwise the inferred default. Use at read sites (chart/table/sidebar/
 * agent CSV) instead of `config.showAs ?? "total"` so the default matches the
 * semantics of the selected metrics.
 *
 * Invariant: callers are expected to clear `showAs` at write time (via
 * `clearInapplicableShowAs`) when it doesn't apply to the current dataset, so
 * we can trust `config.showAs` here without a read-side override.
 */
export function getEffectiveShowAs(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ShowAs {
  return config?.showAs ?? inferShowAs(config, getFactMetricById);
}

/**
 * Strips `showAs` from a config when the current dataset doesn't support it,
 * so the stored value never lies about what will actually render. Call this
 * alongside other write-time normalizers (validateDimensions, fillMissingUnits)
 * whenever a config is created, loaded, or mutated.
 *
 * Returns the same reference when nothing changed so callers can use identity
 * comparisons to avoid unnecessary re-renders.
 */
export function clearInapplicableShowAs<T extends ExplorationConfig>(
  config: T,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): T {
  if (config.showAs === undefined) return config;
  if (showAsAppliesTo(config, getFactMetricById)) return config;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { showAs, ...rest } = config;
  return rest as T;
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
 * Computes the effective numeric value for a single metric result cell, given
 * the effective showAs and whether the underlying metric is a ratio. Ratios
 * always render as N/D regardless of showAs.
 */
export function getEffectiveMetricValue(
  v: { numerator: number | null; denominator: number | null },
  opts: { showAs: ShowAs; isRatio: boolean },
): number {
  const num = v.numerator ?? 0;
  if (opts.isRatio) {
    return v.denominator ? num / v.denominator : num;
  }
  if (opts.showAs === "per_unit") {
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
  return config.dataset.values.map((v) => {
    const m = getFactMetricById(v.metricId ?? "");
    return m?.metricType === "ratio";
  });
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
  // "revenue per user_id" in per_unit mode). Labels carry the display string.
  const dimLabels = getDimensionLabels(config);
  dimLabels.forEach((label, i) => {
    cols.push({ kind: "dimension", key: `__dim_${i}__`, label, dimIndex: i });
  });

  const values = config?.dataset?.values ?? [];
  if (values.length === 0) return cols;

  const isRatio = getIsRatioByIndex(config, getFactMetricById);
  const effectiveShowAs = getEffectiveShowAs(config, getFactMetricById);
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

    let singleLabel = name;
    if (effectiveShowAs === "per_unit") {
      const unit =
        ("unit" in v && typeof v.unit === "string" ? v.unit : null) ||
        sharedUnit ||
        "unit";
      singleLabel = `${name} per ${unit}`;
    }
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
    values: { numerator: number | null; denominator: number | null }[];
  },
  col: ExplorationColumn,
  renderOpts: { showAs: ShowAs; isRatioByIndex: boolean[] },
): string | number | null {
  if (col.kind === "dimension") {
    return row.dimensions[col.dimIndex] ?? null;
  }
  const v = row.values[col.metricIndex];
  if (!v) return null;
  if (col.sub === "numerator") return v.numerator;
  if (col.sub === "denominator") return v.denominator;
  if (col.sub === "value") {
    if (v.numerator != null && v.denominator)
      return v.numerator / v.denominator;
    return null;
  }
  if (v.numerator == null) return null;
  return getEffectiveMetricValue(v, {
    showAs: renderOpts.showAs,
    isRatio: renderOpts.isRatioByIndex[col.metricIndex] ?? false,
  });
}
