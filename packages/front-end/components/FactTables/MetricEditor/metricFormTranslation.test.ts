import {
  applyFormType,
  cappingOk,
  columnsForShape,
  fitColumn,
  formTypeFromStored,
  onDenominatorFactTableChange,
  onFactTableChange,
  onQuantileScopeChange,
  onRetentionDelayOrModeChange,
  onShapeChange,
  retentionModeFromWindow,
  shapeFromColumnRef,
  typeHasShape,
  THRESHOLD_SHAPES,
  windowOk,
  type MetricTypeSwitchState,
} from "./metricFormTranslation";

const factTable = {
  columns: [
    { column: "revenue", datatype: "number" as const },
    { column: "plan", datatype: "string" as const },
    { column: "timestamp", datatype: "date" as const },
    { column: "old_col", datatype: "number" as const, deleted: true },
  ],
};

describe("columnsForShape", () => {
  it("returns [] for count/days/users", () => {
    expect(columnsForShape("count", factTable)).toEqual([]);
    expect(columnsForShape("days", factTable)).toEqual([]);
    expect(columnsForShape("users", factTable)).toEqual([]);
  });

  it("returns numeric columns for sum/max, excluding deleted and timestamp", () => {
    expect(columnsForShape("sum", factTable)).toEqual(["revenue"]);
    expect(columnsForShape("max", factTable)).toEqual(["revenue"]);
  });

  it("returns string columns for distinct", () => {
    expect(columnsForShape("distinct", factTable)).toEqual(["plan"]);
  });

  it("returns [] with no fact table", () => {
    expect(columnsForShape("sum", null)).toEqual([]);
  });

  it("hides distinct when hasCountDistinctHLL is false, leaving other shapes alone", () => {
    expect(columnsForShape("distinct", factTable, false)).toEqual([]);
    expect(columnsForShape("sum", factTable, false)).toEqual(["revenue"]);
  });
});

describe("fitColumn", () => {
  it("returns the sentinel column for count/days/users regardless of current", () => {
    expect(fitColumn("count", factTable, "revenue")).toBe("$$count");
    expect(fitColumn("days", factTable, "revenue")).toBe("$$distinctDates");
    expect(fitColumn("users", factTable, "revenue")).toBe("$$distinctUsers");
  });

  it("keeps the current column when still valid for the shape", () => {
    expect(fitColumn("sum", factTable, "revenue")).toBe("revenue");
  });

  it("falls back to the first valid column when current is invalid", () => {
    expect(fitColumn("sum", factTable, "plan")).toBe("revenue");
    expect(fitColumn("distinct", factTable, "revenue")).toBe("plan");
  });

  it("falls back to empty string when no valid column exists", () => {
    expect(fitColumn("distinct", { columns: [] }, "revenue")).toBe("");
  });

  it("falls back to empty string for distinct when hasCountDistinctHLL is false", () => {
    expect(fitColumn("distinct", factTable, "plan", false)).toBe("");
  });
});

describe("shapeFromColumnRef", () => {
  it("derives each shape from column/aggregation sentinels", () => {
    expect(shapeFromColumnRef({ column: "$$count" })).toBe("count");
    expect(shapeFromColumnRef({ column: "$$distinctDates" })).toBe("days");
    expect(shapeFromColumnRef({ column: "$$distinctUsers" })).toBe("users");
    expect(shapeFromColumnRef({ column: "revenue", aggregation: "sum" })).toBe(
      "sum",
    );
    expect(shapeFromColumnRef({ column: "revenue", aggregation: "max" })).toBe(
      "max",
    );
    expect(
      shapeFromColumnRef({ column: "plan", aggregation: "count distinct" }),
    ).toBe("distinct");
  });

  it("defaults to sum when no aggregation is set", () => {
    expect(shapeFromColumnRef({ column: "revenue" })).toBe("sum");
  });

  it("returns null for sketch aggregations", () => {
    expect(
      shapeFromColumnRef({ column: "sketch", aggregation: "hll merge" }),
    ).toBeNull();
    expect(
      shapeFromColumnRef({ column: "sketch", aggregation: "kll merge" }),
    ).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(shapeFromColumnRef(null)).toBeNull();
  });
});

describe("onShapeChange", () => {
  const base = { factTableId: "ft1", column: "$$count", rowFilters: [] };

  it("refits column and sets aggregation for sum/max/distinct", () => {
    expect(onShapeChange(base, "sum", factTable)).toMatchObject({
      column: "revenue",
      aggregation: "sum",
    });
    expect(onShapeChange(base, "distinct", factTable)).toMatchObject({
      column: "plan",
      aggregation: "count distinct",
    });
  });

  it("clears aggregation for count/days/users", () => {
    const sumRef = { ...base, column: "revenue", aggregation: "sum" as const };
    expect(onShapeChange(sumRef, "count", factTable)).toMatchObject({
      column: "$$count",
      aggregation: undefined,
    });
  });

  it("can't land on a distinct column when hasCountDistinctHLL is false", () => {
    expect(onShapeChange(base, "distinct", factTable, false)).toMatchObject({
      column: "",
      aggregation: "count distinct",
    });
  });
});

describe("onFactTableChange / onDenominatorFactTableChange", () => {
  it("is the same function under both names", () => {
    expect(onDenominatorFactTableChange).toBe(onFactTableChange);
  });

  it("refits the column, clears row filters and aggregate filter", () => {
    const current = {
      factTableId: "old_ft",
      column: "revenue",
      aggregation: "sum" as const,
      rowFilters: [{ column: "plan", operator: "=" as const, values: ["pro"] }],
      aggregateFilterColumn: "$$count",
      aggregateFilter: ">= 3",
    };
    const result = onFactTableChange(current, "new_ft", factTable);
    expect(result.factTableId).toBe("new_ft");
    expect(result.column).toBe("revenue");
    expect(result.rowFilters).toEqual([]);
    expect(result.aggregateFilterColumn).toBeUndefined();
    expect(result.aggregateFilter).toBeUndefined();
  });

  it("falls back to a valid column when the current one doesn't exist on the new table", () => {
    const current = {
      factTableId: "old_ft",
      column: "plan",
      aggregation: "sum" as const,
      rowFilters: [],
    };
    const result = onFactTableChange(current, "new_ft", factTable);
    expect(result.column).toBe("revenue");
  });
});

describe("onQuantileScopeChange", () => {
  it("restricts to numeric columns and clears aggregation for event scope", () => {
    const current = { factTableId: "ft1", column: "plan", rowFilters: [] };
    const result = onQuantileScopeChange(current, "event", factTable);
    expect(result.column).toBe("revenue");
    expect(result.aggregation).toBeUndefined();
  });

  it("restores the shape-based column for unit scope", () => {
    const current = { factTableId: "ft1", column: "revenue", rowFilters: [] };
    const result = onQuantileScopeChange(current, "unit", factTable);
    expect(result.column).toBe("revenue");
    expect(result.aggregation).toBe("sum");
  });
});

describe("retention window reset rules", () => {
  const between = {
    type: "conversion" as const,
    delayValue: 7,
    delayUnit: "days" as const,
    windowValue: 7,
    windowUnit: "days" as const,
  };
  const starting = { ...between, windowValue: 0 };

  it("derives mode from windowValue", () => {
    expect(retentionModeFromWindow(between)).toBe("between");
    expect(retentionModeFromWindow(starting)).toBe("starting");
  });

  it("raises end when a delay change would put it at or below the new delay", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "delay",
      value: 14,
    });
    expect(result.delayValue).toBe(14);
    expect(result.delayValue + result.windowValue).toBeGreaterThan(14);
  });

  it("leaves a valid end alone on a delay change", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "delay",
      value: 3,
    });
    expect(result.delayValue).toBe(3);
    expect(result.windowValue).toBe(11); // end (14) - new delay (3)
  });

  it("zeroes windowValue when switching to starting mode", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "mode",
      value: "starting",
    });
    expect(result.windowValue).toBe(0);
  });

  it("picks a valid end when switching to between mode from starting", () => {
    const result = onRetentionDelayOrModeChange(starting, {
      type: "mode",
      value: "between",
    });
    expect(result.windowValue).toBeGreaterThan(0);
  });

  it("leaves an already-valid between state alone on a mode no-op", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "mode",
      value: "between",
    });
    expect(result).toEqual(between);
  });
});

describe("formTypeFromStored", () => {
  it("maps funnel, ratio, and dailyParticipation directly", () => {
    expect(
      formTypeFromStored({ metricType: "funnel", numerator: null }),
    ).toEqual({
      representable: true,
      type: "funnel",
    });
    expect(
      formTypeFromStored({ metricType: "ratio", numerator: null }),
    ).toEqual({
      representable: true,
      type: "ratio",
    });
    expect(
      formTypeFromStored({ metricType: "dailyParticipation", numerator: null }),
    ).toEqual({ representable: true, type: "dailyParticipation" });
  });

  it("splits proportion into proportion vs. threshold on aggregateFilter presence", () => {
    expect(
      formTypeFromStored({
        metricType: "proportion",
        numerator: { column: "$$count" },
      }),
    ).toEqual({ representable: true, type: "proportion" });
    expect(
      formTypeFromStored({
        metricType: "proportion",
        numerator: {
          column: "$$count",
          aggregateFilterColumn: "$$count",
          aggregateFilter: ">= 3",
        },
      }),
    ).toEqual({ representable: true, type: "threshold" });
  });

  it("keeps retention as retention regardless of an optional threshold", () => {
    expect(
      formTypeFromStored({
        metricType: "retention",
        numerator: {
          column: "$$count",
          aggregateFilterColumn: "$$count",
          aggregateFilter: ">= 3",
        },
      }),
    ).toEqual({ representable: true, type: "retention" });
  });

  it("splits mean five ways by column/aggregation", () => {
    expect(
      formTypeFromStored({
        metricType: "mean",
        numerator: { column: "$$count" },
      }),
    ).toEqual({
      representable: true,
      type: "rowCount",
    });
    expect(
      formTypeFromStored({
        metricType: "mean",
        numerator: { column: "$$distinctDates" },
      }),
    ).toEqual({ representable: true, type: "activeDays" });
    expect(
      formTypeFromStored({
        metricType: "mean",
        numerator: { column: "revenue", aggregation: "sum" },
      }),
    ).toEqual({ representable: true, type: "colSum" });
    expect(
      formTypeFromStored({
        metricType: "mean",
        numerator: { column: "revenue", aggregation: "max" },
      }),
    ).toEqual({ representable: true, type: "colMax" });
    expect(
      formTypeFromStored({
        metricType: "mean",
        numerator: { column: "plan", aggregation: "count distinct" },
      }),
    ).toEqual({ representable: true, type: "countDist" });
  });

  it("flags sketch aggregations as unrepresentable on either side of a ratio", () => {
    expect(
      formTypeFromStored({
        metricType: "ratio",
        numerator: { column: "sketch", aggregation: "hll merge" },
        denominator: { column: "$$count" },
      }),
    ).toEqual({ representable: false, reason: "sketch-aggregation" });
    expect(
      formTypeFromStored({
        metricType: "ratio",
        numerator: { column: "revenue", aggregation: "sum" },
        denominator: { column: "sketch", aggregation: "kll merge" },
      }),
    ).toEqual({ representable: false, reason: "sketch-aggregation" });
    expect(
      formTypeFromStored({
        metricType: "ratio",
        numerator: { column: "revenue", aggregation: "sum" },
        denominator: { column: "$$count" },
      }),
    ).toEqual({ representable: true, type: "ratio" });
  });

  it("flags sketch aggregations as unrepresentable for mean and quantile", () => {
    expect(
      formTypeFromStored({
        metricType: "mean",
        numerator: { column: "sketch", aggregation: "hll merge" },
      }),
    ).toEqual({ representable: false, reason: "sketch-aggregation" });
    expect(
      formTypeFromStored({
        metricType: "quantile",
        numerator: { column: "sketch", aggregation: "kll merge" },
      }),
    ).toEqual({ representable: false, reason: "sketch-aggregation" });
  });

  it("flags sketch aggregations as unrepresentable for proportion, retention, and dailyParticipation too", () => {
    expect(
      formTypeFromStored({
        metricType: "proportion",
        numerator: { column: "sketch", aggregation: "hll merge" },
      }),
    ).toEqual({ representable: false, reason: "sketch-aggregation" });
    expect(
      formTypeFromStored({
        metricType: "retention",
        numerator: { column: "sketch", aggregation: "kll merge" },
      }),
    ).toEqual({ representable: false, reason: "sketch-aggregation" });
    expect(
      formTypeFromStored({
        metricType: "dailyParticipation",
        numerator: { column: "sketch", aggregation: "hll merge" },
      }),
    ).toEqual({ representable: false, reason: "sketch-aggregation" });
  });

  it("flags mean on $$distinctUsers as unrepresentable", () => {
    expect(
      formTypeFromStored({
        metricType: "mean",
        numerator: { column: "$$distinctUsers" },
      }),
    ).toEqual({ representable: false, reason: "mean-on-distinct-users" });
  });

  it("flags a quantileEventCountColumn override as unrepresentable", () => {
    expect(
      formTypeFromStored({
        metricType: "quantile",
        numerator: { column: "revenue" },
        quantileSettings: {
          type: "event",
          quantileEventCountColumn: "revenue_n_events",
        },
      }),
    ).toEqual({ representable: false, reason: "quantile-event-count-column" });
  });

  it("flags a non-numeric aggregateFilter basis as unrepresentable only when a fact table confirms it", () => {
    const stringBasis = {
      metricType: "proportion" as const,
      numerator: {
        column: "$$count",
        aggregateFilterColumn: "plan",
        aggregateFilter: "= foo",
      },
    };
    expect(formTypeFromStored(stringBasis)).toEqual({
      representable: true,
      type: "threshold",
    });
    expect(formTypeFromStored(stringBasis, factTable)).toEqual({
      representable: false,
      reason: "unsupported-aggregate-filter",
    });
  });
});

describe("applyFormType", () => {
  const current: MetricTypeSwitchState = {
    metricType: "proportion",
    numerator: { factTableId: "ft1", column: "$$count", rowFilters: [] },
  };

  it("sets metricType and shape-appropriate column/aggregation", () => {
    const result = applyFormType(current, "colSum", factTable);
    expect(result.metricType).toBe("mean");
    expect(result.numerator).toMatchObject({
      column: "revenue",
      aggregation: "sum",
    });
  });

  it("clears any existing aggregateFilter when the type changes", () => {
    const withFilter = {
      metricType: "proportion" as const,
      numerator: {
        factTableId: "ft1",
        column: "$$count",
        rowFilters: [],
        aggregateFilterColumn: "$$count",
        aggregateFilter: ">= 3",
      },
    };
    const result = applyFormType(withFilter, "rowCount", factTable);
    expect(result.numerator?.aggregateFilterColumn).toBeUndefined();
    expect(result.numerator?.aggregateFilter).toBeUndefined();
  });

  it("sets numerator to null for funnel", () => {
    const result = applyFormType(current, "funnel", factTable);
    expect(result.metricType).toBe("funnel");
    expect(result.numerator).toBeNull();
  });

  it("preserves the fact table id across a type change", () => {
    const result = applyFormType(current, "colMax", factTable);
    expect(result.numerator?.factTableId).toBe("ft1");
  });

  it("initializes a denominator for ratio when none exists", () => {
    const result = applyFormType(current, "ratio", factTable);
    expect(result.denominator).toEqual({
      factTableId: "ft1",
      column: "$$count",
      rowFilters: [],
    });
  });

  it("preserves an existing denominator when switching to ratio", () => {
    const withDenominator = {
      ...current,
      denominator: { factTableId: "ft2", column: "revenue", rowFilters: [] },
    };
    const result = applyFormType(withDenominator, "ratio", factTable);
    expect(result.denominator).toEqual(withDenominator.denominator);
  });

  it("initializes quantileSettings for quantile when none exists", () => {
    const result = applyFormType(current, "quantile", factTable);
    expect(result.quantileSettings).toEqual({
      type: "unit",
      ignoreZeros: false,
      quantile: 0.5,
    });
  });

  it("preserves existing quantileSettings when switching to quantile", () => {
    const withSettings = {
      ...current,
      quantileSettings: {
        type: "event" as const,
        ignoreZeros: true,
        quantile: 0.9,
      },
    };
    const result = applyFormType(withSettings, "quantile", factTable);
    expect(result.quantileSettings).toEqual(withSettings.quantileSettings);
  });

  it("initializes two funnel steps sharing the numerator's fact table when none exist", () => {
    const result = applyFormType(current, "funnel", factTable);
    expect(result.funnelSettings?.steps).toHaveLength(2);
    expect(
      result.funnelSettings?.steps.every((s) => s.factTableId === "ft1"),
    ).toBe(true);
  });

  it("preserves existing funnel steps when switching to funnel", () => {
    const withSteps = {
      ...current,
      funnelSettings: {
        steps: [
          { name: "A", factTableId: "ft1", rowFilters: [], optional: false },
          { name: "B", factTableId: "ft1", rowFilters: [], optional: false },
          { name: "C", factTableId: "ft1", rowFilters: [], optional: false },
        ],
      },
    };
    const result = applyFormType(withSteps, "funnel", factTable);
    expect(result.funnelSettings?.steps).toHaveLength(3);
  });
});

describe("gates", () => {
  it("typeHasShape is true only for the five Value-group types", () => {
    expect(typeHasShape("rowCount")).toBe(true);
    expect(typeHasShape("colSum")).toBe(true);
    expect(typeHasShape("colMax")).toBe(true);
    expect(typeHasShape("countDist")).toBe(true);
    expect(typeHasShape("activeDays")).toBe(true);
    expect(typeHasShape("proportion")).toBe(false);
    expect(typeHasShape("ratio")).toBe(false);
  });

  it("cappingOk is true for ratio and the Value-group types only", () => {
    expect(cappingOk("ratio")).toBe(true);
    expect(cappingOk("colSum")).toBe(true);
    expect(cappingOk("proportion")).toBe(false);
    expect(cappingOk("quantile")).toBe(false);
  });

  it("windowOk is false only for retention", () => {
    expect(windowOk("retention")).toBe(false);
    expect(windowOk("proportion")).toBe(true);
    expect(windowOk("funnel")).toBe(true);
  });

  it("THRESHOLD_SHAPES is exactly count and sum", () => {
    expect(THRESHOLD_SHAPES).toEqual(["count", "sum"]);
  });
});
