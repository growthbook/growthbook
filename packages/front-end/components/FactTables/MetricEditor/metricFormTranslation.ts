import {
  ColumnAggregation,
  ColumnRef,
  FactMetricType,
  FactTableColumnType,
  FunnelSettings,
  FunnelStep,
  MetricQuantileSettings,
  MetricWindowSettings,
} from "shared/types/fact-table";

export const SHAPES = ["count", "sum", "max", "distinct", "days"] as const;
export type Shape = (typeof SHAPES)[number];
export type RatioShape = Shape | "users";

// Threshold basis is count or sum only (spec).
export const THRESHOLD_SHAPES = ["count", "sum"] as const;

type MinimalColumn = {
  column: string;
  datatype: FactTableColumnType;
  deleted?: boolean;
};
type MinimalFactTable = { columns: MinimalColumn[] } | null | undefined;

// columnsFor(shape, factTable) from the spec. [] means omit the Column field.
export function columnsForShape(
  shape: RatioShape,
  factTable: MinimalFactTable,
): string[] {
  if (
    !factTable ||
    shape === "count" ||
    shape === "days" ||
    shape === "users"
  ) {
    return [];
  }
  const columns = factTable.columns.filter(
    (c) => !c.deleted && c.column !== "timestamp",
  );
  if (shape === "distinct") {
    return columns.filter((c) => c.datatype === "string").map((c) => c.column);
  }
  return columns.filter((c) => c.datatype === "number").map((c) => c.column);
}

export function fitColumn(
  shape: RatioShape,
  factTable: MinimalFactTable,
  currentColumn: string,
): string {
  if (shape === "count") return "$$count";
  if (shape === "days") return "$$distinctDates";
  if (shape === "users") return "$$distinctUsers";
  const candidates = columnsForShape(shape, factTable);
  return candidates.includes(currentColumn)
    ? currentColumn
    : (candidates[0] ?? "");
}

function aggregationForShape(shape: Shape): ColumnAggregation | undefined {
  if (shape === "sum") return "sum";
  if (shape === "max") return "max";
  if (shape === "distinct") return "count distinct";
  return undefined;
}

// Shape is never stored separately - always recoverable from column + aggregation.
export function shapeFromColumnRef(
  ref: Pick<ColumnRef, "column" | "aggregation"> | null | undefined,
): RatioShape | null {
  if (!ref) return null;
  if (ref.column === "$$count") return "count";
  if (ref.column === "$$distinctDates") return "days";
  if (ref.column === "$$distinctUsers") return "users";
  if (ref.aggregation === "hll merge" || ref.aggregation === "kll merge") {
    return null;
  }
  if (ref.aggregation === "count distinct") return "distinct";
  if (ref.aggregation === "max") return "max";
  return "sum";
}

export function onShapeChange(
  current: ColumnRef,
  newShape: RatioShape,
  factTable: MinimalFactTable,
): ColumnRef {
  return {
    ...current,
    column: fitColumn(newShape, factTable, current.column),
    aggregation:
      newShape === "users" ? undefined : aggregationForShape(newShape as Shape),
  };
}

// Per-part refit for a fact-table change. Which parts to call this on for a
// given type (one vs. every part) is a MetricEditor (PR 3) orchestration call.
export function onFactTableChange(
  current: ColumnRef,
  newFactTableId: string,
  factTable: MinimalFactTable,
): ColumnRef {
  const shape = shapeFromColumnRef(current) ?? "sum";
  return {
    ...current,
    factTableId: newFactTableId,
    column: fitColumn(shape, factTable, current.column),
    rowFilters: [],
    aggregateFilterColumn: undefined,
    aggregateFilter: undefined,
  };
}

export const onDenominatorFactTableChange = onFactTableChange;

export function onQuantileScopeChange(
  current: ColumnRef,
  newScope: "unit" | "event",
  factTable: MinimalFactTable,
): ColumnRef {
  if (newScope === "event") {
    const numericColumns = columnsForShape("sum", factTable);
    return {
      ...current,
      column: numericColumns.includes(current.column)
        ? current.column
        : (numericColumns[0] ?? ""),
      aggregation: undefined,
    };
  }
  const shape = shapeFromColumnRef(current) ?? "sum";
  return {
    ...current,
    column: fitColumn(shape, factTable, current.column),
    aggregation:
      shape === "users" ? undefined : aggregationForShape(shape as Shape),
  };
}

export type RetentionWindowChange =
  | { type: "delay"; value: number }
  | { type: "mode"; value: "starting" | "between" };

// No separate "mode" field in storage: windowValue > 0 IS "between" (spec).
export function retentionModeFromWindow(
  windowSettings: Pick<MetricWindowSettings, "windowValue">,
): "starting" | "between" {
  return windowSettings.windowValue > 0 ? "between" : "starting";
}

export function onRetentionDelayOrModeChange(
  windowSettings: MetricWindowSettings,
  change: RetentionWindowChange,
): MetricWindowSettings {
  if (change.type === "mode") {
    if (change.value === "starting") {
      return { ...windowSettings, windowValue: 0 };
    }
    if (windowSettings.windowValue > 0) return windowSettings;
    return { ...windowSettings, windowValue: 1 };
  }

  const newDelay = change.value;
  if (retentionModeFromWindow(windowSettings) !== "between") {
    return { ...windowSettings, delayValue: newDelay };
  }
  const currentEnd = windowSettings.delayValue + windowSettings.windowValue;
  const end = currentEnd <= newDelay ? newDelay + 1 : currentEnd;
  return {
    ...windowSettings,
    delayValue: newDelay,
    windowValue: end - newDelay,
  };
}

// The 12 form types classify the same stored fields differently; they aren't
// a separate shape. So the only real translation is classifying stored data
// (formTypeFromStored) and applying a newly-chosen type on top of the
// existing fields (applyFormType) - not a generic bidirectional mapper.

export const FORM_METRIC_TYPES = [
  "proportion",
  "threshold",
  "retention",
  "funnel",
  "rowCount",
  "colSum",
  "colMax",
  "countDist",
  "activeDays",
  "ratio",
  "quantile",
  "dailyParticipation",
] as const;
export type FormMetricType = (typeof FORM_METRIC_TYPES)[number];

const SHAPE_FORM_TYPES: ReadonlySet<FormMetricType> = new Set([
  "rowCount",
  "colSum",
  "colMax",
  "countDist",
  "activeDays",
]);

// Gates from the spec.
export function typeHasShape(type: FormMetricType): boolean {
  return SHAPE_FORM_TYPES.has(type);
}

export function cappingOk(type: FormMetricType): boolean {
  return type === "ratio" || typeHasShape(type);
}

export function windowOk(type: FormMetricType): boolean {
  return type !== "retention";
}

export type UnrepresentableReason =
  | "sketch-aggregation"
  | "quantile-event-count-column"
  | "mean-on-distinct-users"
  | "unsupported-aggregate-filter";

export type FormTypeResult =
  | { representable: true; type: FormMetricType }
  | { representable: false; reason: UnrepresentableReason };

type MinimalNumerator = Pick<
  ColumnRef,
  "column" | "aggregation" | "aggregateFilterColumn" | "aggregateFilter"
> | null;

// aggregateFilterColumn is schema-documented as always $$count or a summed
// numeric column; only a string/boolean column (needs a factTable to detect)
// makes it an unrepresentable Threshold basis.
function isValidThresholdBasis(
  aggregateFilterColumn: string,
  factTable: MinimalFactTable,
): boolean {
  if (aggregateFilterColumn === "$$count") return true;
  if (!factTable) return true;
  const col = factTable.columns.find((c) => c.column === aggregateFilterColumn);
  if (!col) return true;
  return col.datatype === "number";
}

// "aggregation: 'hll merge' or 'kll merge' — sketch columns" (spec) is stated
// generally, not scoped to one metric type — apply it to every ColumnRef part
// that carries a real aggregation, including both sides of a ratio.
function isSketchAggregation(ref: MinimalNumerator | undefined): boolean {
  return ref?.aggregation === "hll merge" || ref?.aggregation === "kll merge";
}

export function formTypeFromStored(
  metric: {
    metricType: FactMetricType;
    numerator: MinimalNumerator;
    denominator?: MinimalNumerator;
    quantileSettings?: {
      type: "unit" | "event";
      quantileEventCountColumn?: string;
    } | null;
  },
  factTable?: MinimalFactTable,
): FormTypeResult {
  const { metricType, numerator, denominator, quantileSettings } = metric;

  if (metricType === "funnel") return { representable: true, type: "funnel" };
  if (metricType === "ratio") {
    if (isSketchAggregation(numerator) || isSketchAggregation(denominator)) {
      return { representable: false, reason: "sketch-aggregation" };
    }
    return { representable: true, type: "ratio" };
  }
  if (metricType === "dailyParticipation") {
    return { representable: true, type: "dailyParticipation" };
  }

  if (metricType === "retention") {
    if (
      numerator?.aggregateFilterColumn &&
      !isValidThresholdBasis(numerator.aggregateFilterColumn, factTable)
    ) {
      return { representable: false, reason: "unsupported-aggregate-filter" };
    }
    return { representable: true, type: "retention" };
  }

  if (metricType === "proportion") {
    if (numerator?.aggregateFilterColumn) {
      if (!isValidThresholdBasis(numerator.aggregateFilterColumn, factTable)) {
        return { representable: false, reason: "unsupported-aggregate-filter" };
      }
      return { representable: true, type: "threshold" };
    }
    return { representable: true, type: "proportion" };
  }

  if (metricType === "quantile") {
    if (isSketchAggregation(numerator)) {
      return { representable: false, reason: "sketch-aggregation" };
    }
    if (quantileSettings?.quantileEventCountColumn) {
      return { representable: false, reason: "quantile-event-count-column" };
    }
    return { representable: true, type: "quantile" };
  }

  // metricType === "mean"
  if (isSketchAggregation(numerator)) {
    return { representable: false, reason: "sketch-aggregation" };
  }
  if (numerator?.column === "$$distinctUsers") {
    return { representable: false, reason: "mean-on-distinct-users" };
  }
  if (numerator?.column === "$$count")
    return { representable: true, type: "rowCount" };
  if (numerator?.column === "$$distinctDates") {
    return { representable: true, type: "activeDays" };
  }
  if (numerator?.aggregation === "max")
    return { representable: true, type: "colMax" };
  if (numerator?.aggregation === "count distinct") {
    return { representable: true, type: "countDist" };
  }
  return { representable: true, type: "colSum" };
}

function storedTypeAndShapeFor(formType: FormMetricType): {
  metricType: FactMetricType;
  shape: Shape | null;
} {
  switch (formType) {
    case "proportion":
    case "threshold":
      return { metricType: "proportion", shape: "count" };
    case "retention":
      return { metricType: "retention", shape: "count" };
    case "funnel":
      return { metricType: "funnel", shape: null };
    case "rowCount":
      return { metricType: "mean", shape: "count" };
    case "colSum":
      return { metricType: "mean", shape: "sum" };
    case "colMax":
      return { metricType: "mean", shape: "max" };
    case "countDist":
      return { metricType: "mean", shape: "distinct" };
    case "activeDays":
      return { metricType: "mean", shape: "days" };
    case "ratio":
      return { metricType: "ratio", shape: "sum" };
    case "quantile":
      return { metricType: "quantile", shape: "sum" };
    case "dailyParticipation":
      return { metricType: "dailyParticipation", shape: "count" };
  }
}

export type MetricTypeSwitchState = {
  metricType: FactMetricType;
  numerator: ColumnRef | null;
  denominator?: ColumnRef | null;
  quantileSettings?: MetricQuantileSettings | null;
  funnelSettings?: FunnelSettings | null;
};

const DEFAULT_QUANTILE = 0.5;

function defaultFunnelStep(name: string, factTableId: string): FunnelStep {
  return {
    name,
    factTableId,
    rowFilters: [],
    optional: false,
    conversionWindow: null,
  };
}

/**
 * Reset rule: metric type change -> refit the column for the new type's
 * shape. Also initializes the extra fields a type requires to be valid
 * (ratio's denominator, quantile's quantileSettings, funnel's
 * funnelSettings.steps) when they aren't already set, since the schema
 * requires all three for their respective metricType — but never overwrites
 * one that's already there, so switching away and back doesn't lose it.
 */
export function applyFormType<T extends MetricTypeSwitchState>(
  current: T,
  newFormType: FormMetricType,
  factTable: MinimalFactTable,
): T {
  const { metricType, shape } = storedTypeAndShapeFor(newFormType);
  const sourceFactTableId = current.numerator?.factTableId ?? "";

  if (newFormType === "funnel") {
    const funnelSettings =
      current.funnelSettings && current.funnelSettings.steps.length >= 2
        ? current.funnelSettings
        : {
            steps: [
              defaultFunnelStep("Step 1", sourceFactTableId),
              defaultFunnelStep("Step 2", sourceFactTableId),
            ],
          };
    return { ...current, metricType, numerator: null, funnelSettings };
  }

  const base: ColumnRef = current.numerator ?? {
    factTableId: "",
    column: "",
    rowFilters: [],
  };

  const numerator: ColumnRef = {
    ...base,
    column: shape ? fitColumn(shape, factTable, base.column) : base.column,
    aggregation:
      shape && shape !== "count" ? aggregationForShape(shape) : undefined,
    aggregateFilterColumn: undefined,
    aggregateFilter: undefined,
  };

  return {
    ...current,
    metricType,
    numerator,
    ...(newFormType === "ratio" && {
      denominator: current.denominator ?? {
        factTableId: numerator.factTableId,
        column: "$$count",
        rowFilters: [],
      },
    }),
    ...(newFormType === "quantile" && {
      quantileSettings: current.quantileSettings ?? {
        type: "unit" as const,
        ignoreZeros: false,
        quantile: DEFAULT_QUANTILE,
      },
    }),
  };
}
