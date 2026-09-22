import {
  aggregationForShape,
  applyFormType,
  availableShapes,
  cappingOk,
  columnsForShape,
  columnValueLabel,
  fitColumn,
  formTypeFromStored,
  onFactTableChange,
  onQuantileScopeChange,
  onRetentionDelayOrModeChange,
  onShapeChange,
  retentionEnd,
  normalizeRetentionWindow,
  retentionModeFromWindow,
  shapeForValueType,
  shapeFromColumnRef,
  typeHasShape,
  THRESHOLD_SHAPES,
  windowOk,
  type MetricTypeSwitchState,
} from "./metricFormTranslation";

const dialect = { hasCountDistinctHLL: () => false };
const hllDialect = { hasCountDistinctHLL: () => true };

const columnDefaults = {
  dateCreated: new Date(0),
  dateUpdated: new Date(0),
  name: "",
  description: "",
  numberFormat: "" as const,
  deleted: false,
};

const factTable = {
  id: "ft1",
  columns: [
    {
      ...columnDefaults,
      column: "revenue",
      name: "Revenue (USD)",
      datatype: "number" as const,
    },
    { ...columnDefaults, column: "plan", datatype: "string" as const },
    { ...columnDefaults, column: "timestamp", datatype: "date" as const },
    {
      ...columnDefaults,
      column: "old_col",
      datatype: "number" as const,
      deleted: true,
    },
    { ...columnDefaults, column: "user_id", datatype: "number" as const },
  ],
  userIdTypes: ["user_id"],
};

describe("columnsForShape", () => {
  it("returns [] for count/days/users", () => {
    expect(columnsForShape("count", factTable, dialect)).toEqual([]);
    expect(columnsForShape("days", factTable, dialect)).toEqual([]);
    expect(columnsForShape("users", factTable, dialect)).toEqual([]);
  });

  it("returns numeric columns for sum/max, excluding deleted and timestamp", () => {
    expect(columnsForShape("sum", factTable, dialect)).toEqual(["revenue"]);
    expect(columnsForShape("max", factTable, dialect)).toEqual(["revenue"]);
  });

  it("returns string columns for distinct when hasCountDistinctHLL is true", () => {
    expect(columnsForShape("distinct", factTable, hllDialect)).toEqual([
      "plan",
    ]);
  });

  it("returns [] with no fact table", () => {
    expect(columnsForShape("sum", null, dialect)).toEqual([]);
  });

  it("hides distinct when hasCountDistinctHLL is false, leaving other shapes alone", () => {
    expect(columnsForShape("distinct", factTable, dialect)).toEqual([]);
    expect(columnsForShape("sum", factTable, dialect)).toEqual(["revenue"]);
  });

  it("excludes userIdTypes columns even when numeric", () => {
    expect(columnsForShape("sum", factTable, dialect)).not.toContain("user_id");
  });

  it("excludes string identifiers from count-distinct choices", () => {
    expect(
      columnsForShape(
        "distinct",
        {
          columns: [
            { ...columnDefaults, column: "account_id", datatype: "string" },
            { ...columnDefaults, column: "plan", datatype: "string" },
          ],
          userIdTypes: ["account_id"],
        },
        hllDialect,
      ),
    ).toEqual(["plan"]);
  });

  it("excludes the fact table's configured timestamp column, not just the literal string 'timestamp'", () => {
    const customTimestampTable = {
      columns: [
        { ...columnDefaults, column: "revenue", datatype: "number" as const },
        {
          ...columnDefaults,
          column: "event_time",
          datatype: "number" as const,
        },
      ],
      timestampColumn: "event_time",
    };
    expect(columnsForShape("sum", customTimestampTable, dialect)).toEqual([
      "revenue",
    ]);
  });
});

describe("availableShapes", () => {
  it("always includes count/days/users regardless of HLL or columns", () => {
    expect(availableShapes(["count", "days", "users"], null, dialect)).toEqual([
      "count",
      "days",
      "users",
    ]);
  });

  it("excludes distinct when hasCountDistinctHLL is false", () => {
    expect(availableShapes(["sum", "distinct"], factTable, dialect)).toEqual([
      "sum",
    ]);
    expect(availableShapes(["sum", "distinct"], factTable, hllDialect)).toEqual(
      ["sum", "distinct"],
    );
  });

  it("excludes sum/max/distinct when the fact table has no matching column", () => {
    const noNumericTable = {
      columns: [
        { ...columnDefaults, column: "plan", datatype: "string" as const },
      ],
    };
    expect(
      availableShapes(["count", "sum", "max"], noNumericTable, dialect),
    ).toEqual(["count"]);
  });
});

describe("fitColumn", () => {
  it("returns the sentinel column for count/days/users regardless of current", () => {
    expect(fitColumn("count", factTable, "revenue", dialect)).toBe("$$count");
    expect(fitColumn("days", factTable, "revenue", dialect)).toBe(
      "$$distinctDates",
    );
    expect(fitColumn("users", factTable, "revenue", dialect)).toBe(
      "$$distinctUsers",
    );
  });

  it("keeps the current column when still valid for the shape", () => {
    expect(fitColumn("sum", factTable, "revenue", dialect)).toBe("revenue");
  });

  it("falls back to the first valid column when current is invalid", () => {
    expect(fitColumn("sum", factTable, "plan", dialect)).toBe("revenue");
    expect(fitColumn("distinct", factTable, "revenue", hllDialect)).toBe(
      "plan",
    );
  });

  it("falls back to empty string when no valid column exists", () => {
    expect(fitColumn("distinct", { columns: [] }, "revenue", dialect)).toBe("");
  });

  it("falls back to empty string for distinct when hasCountDistinctHLL is false", () => {
    expect(fitColumn("distinct", factTable, "plan", dialect)).toBe("");
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
    expect(onShapeChange(base, "sum", factTable, dialect)).toMatchObject({
      column: "revenue",
      aggregation: "sum",
    });
    expect(
      onShapeChange(base, "distinct", factTable, hllDialect),
    ).toMatchObject({
      column: "plan",
      aggregation: "count distinct",
    });
  });

  it("clears aggregation for count/days/users", () => {
    const sumRef = { ...base, column: "revenue", aggregation: "sum" as const };
    expect(onShapeChange(sumRef, "count", factTable, dialect)).toMatchObject({
      column: "$$count",
      aggregation: undefined,
    });
  });

  it("can't land on a distinct column when hasCountDistinctHLL is false", () => {
    expect(onShapeChange(base, "distinct", factTable, dialect)).toMatchObject({
      column: "",
      aggregation: "count distinct",
    });
  });
});

describe("onFactTableChange", () => {
  it("refits the column, clears row filters and aggregate filter", () => {
    const current = {
      factTableId: "old_ft",
      column: "revenue",
      aggregation: "sum" as const,
      rowFilters: [{ column: "plan", operator: "=" as const, values: ["pro"] }],
      aggregateFilterColumn: "$$count",
      aggregateFilter: ">= 3",
    };
    const result = onFactTableChange(
      current,
      { ...factTable, id: "new_ft" },
      dialect,
    );
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
    const result = onFactTableChange(
      current,
      { ...factTable, id: "new_ft" },
      dialect,
    );
    expect(result.column).toBe("revenue");
  });
});

describe("onQuantileScopeChange", () => {
  it("restricts to numeric columns and clears aggregation for event scope", () => {
    const current = { factTableId: "ft1", column: "plan", rowFilters: [] };
    const result = onQuantileScopeChange(current, "event", factTable, dialect);
    expect(result.column).toBe("revenue");
    expect(result.aggregation).toBeUndefined();
  });

  it("restores the shape-based column for unit scope", () => {
    const current = { factTableId: "ft1", column: "revenue", rowFilters: [] };
    const result = onQuantileScopeChange(current, "unit", factTable, dialect);
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

  it("derives mode from the active conversion window", () => {
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

  it("zeroes windowValue and clears type when switching to starting mode", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "mode",
      value: "starting",
    });
    expect(result.windowValue).toBe(0);
    // The query only enforces an upper bound when type === "conversion" - a
    // stale "conversion" here combined with the forced windowValue: 0 would
    // produce an upper bound equal to the lower bound (always-false).
    expect(result.type).toBe("");
  });

  it("picks a valid end and sets type: conversion when switching to between mode from starting", () => {
    const result = onRetentionDelayOrModeChange(starting, {
      type: "mode",
      value: "between",
    });
    expect(result.windowValue).toBeGreaterThan(0);
    // Otherwise the query never enforces the upper bound this mode implies.
    expect(result.type).toBe("conversion");
  });

  it("leaves an already-valid between state alone on a mode no-op", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "mode",
      value: "between",
    });
    expect(result).toEqual(between);
  });

  it("derives windowValue from a direct end edit", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "end",
      value: 20,
    });
    expect(result.windowValue).toBe(13); // 20 - delay (7)
  });

  it("floors windowValue at 1 when end would put it at or below delay", () => {
    const result = onRetentionDelayOrModeChange(between, {
      type: "end",
      value: 5,
    });
    expect(result.windowValue).toBe(1);
  });

  it("uses the smaller unit for retention display and edits", () => {
    const mixedUnits = {
      type: "conversion" as const,
      delayValue: 7,
      delayUnit: "days" as const,
      windowValue: 24,
      windowUnit: "hours" as const,
    };
    expect(retentionEnd(mixedUnits)).toBe(192);
    expect(normalizeRetentionWindow(mixedUnits)).toMatchObject({
      delayValue: 168,
      delayUnit: "hours",
      windowValue: 24,
      windowUnit: "hours",
    });

    const result = onRetentionDelayOrModeChange(mixedUnits, {
      type: "delay",
      value: 192,
    });
    expect(result.windowUnit).toBe("hours");
    expect(retentionEnd(result)).toBe(193);
  });
});

describe("formTypeFromStored", () => {
  it("throws instead of silently misclassifying an unrecognized metricType as mean", () => {
    // FactMetricType is a closed union today, so this cast simulates a future
    // 8th value the switch above hasn't been taught about yet.
    const futureType = "unknownFutureType" as unknown as "mean";
    expect(() =>
      formTypeFromStored({ metricType: futureType, numerator: null }),
    ).toThrow(/Unhandled metric type/);
  });

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
    numerator: {
      factTableId: "ft1",
      column: "$$distinctUsers",
      rowFilters: [],
    },
  };

  it("sets metricType and shape-appropriate column/aggregation", () => {
    const result = applyFormType(current, "colSum", factTable, dialect);
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
    const result = applyFormType(withFilter, "rowCount", factTable, dialect);
    expect(result.numerator?.aggregateFilterColumn).toBeUndefined();
    expect(result.numerator?.aggregateFilter).toBeUndefined();
  });

  it("sets numerator to null for funnel", () => {
    const result = applyFormType(current, "funnel", factTable, dialect);
    expect(result.metricType).toBe("funnel");
    expect(result.numerator).toBeNull();
  });

  it("preserves the fact table id across a type change", () => {
    const result = applyFormType(current, "colMax", factTable, dialect);
    expect(result.numerator?.factTableId).toBe("ft1");
  });

  it("initializes a denominator for ratio when none exists", () => {
    const result = applyFormType(current, "ratio", factTable, dialect);
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
    const result = applyFormType(withDenominator, "ratio", factTable, dialect);
    expect(result.denominator).toEqual(withDenominator.denominator);
  });

  it("clears a stale denominator when switching away from ratio", () => {
    const withDenominator = {
      ...current,
      metricType: "ratio" as const,
      denominator: { factTableId: "ft2", column: "revenue", rowFilters: [] },
    };
    const result = applyFormType(withDenominator, "colSum", factTable, dialect);
    expect(result.denominator).toBeNull();
  });

  it("initializes quantileSettings for quantile when none exists", () => {
    const result = applyFormType(current, "quantile", factTable, dialect);
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
    const result = applyFormType(withSettings, "quantile", factTable, dialect);
    expect(result.quantileSettings).toEqual(withSettings.quantileSettings);
  });

  it("clears stale quantileSettings when switching away from quantile", () => {
    const withSettings = {
      ...current,
      metricType: "quantile" as const,
      quantileSettings: {
        type: "event" as const,
        ignoreZeros: true,
        quantile: 0.9,
      },
    };
    const result = applyFormType(withSettings, "colSum", factTable, dialect);
    expect(result.quantileSettings).toBeNull();
  });

  it("clears a stale denominator and quantileSettings when switching to funnel", () => {
    const withBoth = {
      ...current,
      metricType: "ratio" as const,
      denominator: { factTableId: "ft2", column: "revenue", rowFilters: [] },
      quantileSettings: {
        type: "event" as const,
        ignoreZeros: true,
        quantile: 0.9,
      },
    };
    const result = applyFormType(withBoth, "funnel", factTable, dialect);
    expect(result.denominator).toBeNull();
    expect(result.quantileSettings).toBeNull();
  });

  it("initializes two funnel steps sharing the numerator's fact table when none exist", () => {
    const result = applyFormType(current, "funnel", factTable, dialect);
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
    const result = applyFormType(withSteps, "funnel", factTable, dialect);
    expect(result.funnelSettings?.steps).toHaveLength(3);
  });

  it("uses $$distinctUsers for proportion, threshold, and retention (not $$count)", () => {
    expect(
      applyFormType(current, "proportion", factTable, dialect).numerator,
    ).toMatchObject({
      column: "$$distinctUsers",
    });
    expect(
      applyFormType(current, "threshold", factTable, dialect).numerator,
    ).toMatchObject({
      column: "$$distinctUsers",
    });
    expect(
      applyFormType(current, "retention", factTable, dialect).numerator,
    ).toMatchObject({
      column: "$$distinctUsers",
    });
  });

  it("uses $$distinctDates for dailyParticipation (not $$count)", () => {
    expect(
      applyFormType(current, "dailyParticipation", factTable, dialect)
        .numerator,
    ).toMatchObject({ column: "$$distinctDates" });
  });

  it("round-trips: applying a type and re-classifying it recovers the same form type", () => {
    const roundTrippableTypes = [
      "proportion",
      "threshold",
      "retention",
      "rowCount",
      "colSum",
      "colMax",
      "countDist",
      "activeDays",
      "ratio",
      "quantile",
      "dailyParticipation",
    ] as const;
    for (const type of roundTrippableTypes) {
      const applied = applyFormType(current, type, factTable, hllDialect);
      expect(formTypeFromStored(applied, factTable)).toEqual({
        representable: true,
        type,
      });
    }
  });

  it("preserves an existing threshold filter already on the numerator", () => {
    const withFilter: MetricTypeSwitchState = {
      metricType: "proportion",
      numerator: {
        factTableId: "ft1",
        column: "$$distinctUsers",
        rowFilters: [],
        aggregateFilterColumn: "revenue",
        aggregateFilter: ">= 100",
      },
    };
    const result = applyFormType(withFilter, "threshold", factTable, dialect);
    expect(result.numerator).toMatchObject({
      aggregateFilterColumn: "revenue",
      aggregateFilter: ">= 100",
    });
  });

  it("clears the threshold filter when switching to plain proportion", () => {
    const withFilter = applyFormType(current, "threshold", factTable, dialect);
    if (!withFilter.numerator) throw new Error("expected a numerator");
    const customized = {
      ...withFilter,
      numerator: {
        ...withFilter.numerator,
        aggregateFilterColumn: "revenue",
        aggregateFilter: ">= 100",
      },
    };
    const result = applyFormType(customized, "proportion", factTable, dialect);
    expect(result.numerator?.aggregateFilterColumn).toBeUndefined();
    expect(result.numerator?.aggregateFilter).toBeUndefined();
  });

  it("clears capping when switching to a type cappingOk forbids", () => {
    const withCapping = {
      ...current,
      cappingSettings: { type: "percentile" as const, value: 0.99 },
    };
    const result = applyFormType(withCapping, "quantile", factTable, dialect);
    expect(result.cappingSettings?.type).toBe("");
  });

  it.each([100, 0.5])(
    "resets an absolute cap of %s to an unconfigured percentile for ratio",
    (value) => {
      const withCapping = {
        ...current,
        cappingSettings: {
          type: "absolute" as const,
          value,
          ignoreZeros: true,
        },
      };
      const result = applyFormType(withCapping, "ratio", factTable, dialect);
      expect(result.cappingSettings).toEqual({
        type: "percentile",
        value: 0,
        ignoreZeros: true,
      });
      expect(withCapping.cappingSettings).toEqual({
        type: "absolute",
        value,
        ignoreZeros: true,
      });
    },
  );

  it.each(["", "percentile"] as const)(
    "preserves %s capping when switching to ratio",
    (type) => {
      const withCapping = {
        ...current,
        cappingSettings: { type, value: 0.95, ignoreZeros: false },
      };
      expect(
        applyFormType(withCapping, "ratio", factTable, dialect).cappingSettings,
      ).toEqual(withCapping.cappingSettings);
    },
  );

  it("preserves capping when switching between two cappingOk types", () => {
    const withCapping = {
      ...current,
      cappingSettings: { type: "percentile" as const, value: 0.99 },
    };
    const result = applyFormType(withCapping, "colSum", factTable, dialect);
    expect(result.cappingSettings?.type).toBe("percentile");
  });

  it.each([
    "proportion",
    "threshold",
    "funnel",
    "rowCount",
    "colSum",
    "colMax",
    "countDist",
    "activeDays",
    "ratio",
    "quantile",
    "dailyParticipation",
  ] as const)(
    "clears the delay and conversion window when leaving retention for %s",
    (nextType) => {
      const retentionState: MetricTypeSwitchState = {
        metricType: "retention",
        numerator: {
          factTableId: "ft1",
          column: "$$distinctUsers",
          rowFilters: [],
        },
        windowSettings: {
          type: "conversion",
          windowUnit: "days",
          windowValue: 3,
          delayUnit: "days",
          delayValue: 7,
        },
      };
      const result = applyFormType(
        retentionState,
        nextType,
        factTable,
        dialect,
      );
      expect(result.windowSettings).toMatchObject({
        delayValue: 0,
        delayUnit: "hours",
        type: "",
        windowValue: 0,
      });
    },
  );

  it("seeds a non-zero delay when switching into retention with a zero delay", () => {
    const withZeroDelay = {
      ...current,
      windowSettings: {
        type: "conversion" as const,
        windowUnit: "hours" as const,
        windowValue: 1,
        delayUnit: "hours" as const,
        delayValue: 0,
      },
    };
    const result = applyFormType(
      withZeroDelay,
      "retention",
      factTable,
      dialect,
    );
    expect(result.windowSettings).toMatchObject({
      delayValue: 7,
      delayUnit: "days",
      // A fresh metric switching into retention must not display a bounded
      // window ("Between X and Y days") while querying unbounded.
      type: "conversion",
    });
  });

  it("leaves a non-zero delay alone when switching into retention", () => {
    const withDelay = {
      ...current,
      windowSettings: {
        type: "conversion" as const,
        windowUnit: "hours" as const,
        windowValue: 1,
        delayUnit: "hours" as const,
        delayValue: 12,
      },
    };
    const result = applyFormType(withDelay, "retention", factTable, dialect);
    expect(result.windowSettings?.delayValue).toBe(12);
    expect(result.windowSettings?.type).toBe("conversion");
  });

  it("sets type to empty (not conversion) when switching into retention in starting mode", () => {
    const startingMode = {
      ...current,
      windowSettings: {
        // A prior type left behind by whichever type this metric was before -
        // must not leak into retention's own bounding logic.
        type: "conversion" as const,
        windowUnit: "hours" as const,
        windowValue: 0,
        delayUnit: "hours" as const,
        delayValue: 12,
      },
    };
    const result = applyFormType(startingMode, "retention", factTable, dialect);
    expect(result.windowSettings?.type).toBe("");
  });
});

describe("shapeForValueType", () => {
  it("returns the pinned shape for each Value-group type", () => {
    expect(shapeForValueType("rowCount")).toBe("count");
    expect(shapeForValueType("colSum")).toBe("sum");
    expect(shapeForValueType("colMax")).toBe("max");
    expect(shapeForValueType("countDist")).toBe("distinct");
    expect(shapeForValueType("activeDays")).toBe("days");
  });

  it("returns undefined for types with no pinned shape", () => {
    expect(shapeForValueType("proportion")).toBeUndefined();
    expect(shapeForValueType("ratio")).toBeUndefined();
    expect(shapeForValueType("quantile")).toBeUndefined();
    expect(shapeForValueType("funnel")).toBeUndefined();
  });
});

describe("aggregationForShape", () => {
  it("returns the aggregation for sum/max/distinct", () => {
    expect(aggregationForShape("sum")).toBe("sum");
    expect(aggregationForShape("max")).toBe("max");
    expect(aggregationForShape("distinct")).toBe("count distinct");
  });

  it("returns undefined for count/days/users", () => {
    expect(aggregationForShape("count")).toBeUndefined();
    expect(aggregationForShape("days")).toBeUndefined();
    expect(aggregationForShape("users")).toBeUndefined();
  });
});

describe("columnValueLabel", () => {
  it("translates sentinel columns to plain English", () => {
    expect(columnValueLabel("$$count")).toBe("Count of Rows");
    expect(columnValueLabel("$$distinctUsers")).toBe("Unique Users");
    expect(columnValueLabel("$$distinctDates")).toBe("Distinct Dates");
  });

  it("returns the raw column id unchanged when no factTable is given", () => {
    expect(columnValueLabel("revenue")).toBe("revenue");
  });

  it("resolves a real column's display name from the fact table", () => {
    expect(columnValueLabel("revenue", factTable)).toBe("Revenue (USD)");
  });

  it("falls back to the raw column id when the fact table has no name for it", () => {
    expect(columnValueLabel("plan", factTable)).toBe("plan");
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

describe("stored retention window semantics", () => {
  const windowSettings = {
    type: "conversion" as const,
    delayValue: 7,
    delayUnit: "days" as const,
    windowValue: 12,
    windowUnit: "hours" as const,
  };
  it("ignores an inactive window's stored width", () => {
    expect(retentionModeFromWindow({ ...windowSettings, type: "" })).toBe(
      "starting",
    );
  });
  it("preserves a positive fractional interval when editing its endpoint", () => {
    expect(
      retentionEnd(
        onRetentionDelayOrModeChange(windowSettings, {
          type: "end",
          value: 180,
        }),
      ),
    ).toBe(180);
  });
  it("does not reinterpret an experiment-end lookback as an exposure window", () => {
    expect(
      formTypeFromStored({
        metricType: "retention",
        numerator: null,
        windowSettings: { type: "lookback" },
      }),
    ).toEqual({ representable: false, reason: "retention-lookback-window" });
  });
});

describe("PR review regressions", () => {
  const table = {
    ...factTable,
    userIdColumns: { user_id: "uid" },
    columns: [
      ...factTable.columns,
      { ...columnDefaults, column: "uid", datatype: "number" as const },
      {
        ...columnDefaults,
        column: "event",
        datatype: "string" as const,
        alwaysInlineFilter: true,
      },
    ],
  };
  const filters = [{ column: "event", operator: "=", values: [""] }];
  const current: MetricTypeSwitchState = {
    metricType: "mean",
    numerator: { factTableId: table.id, column: "$$count", rowFilters: [] },
  };

  it("excludes mapped identifier columns from metric values", () => {
    expect(columnsForShape("sum", table, hllDialect)).toEqual(["revenue"]);
    expect(
      columnsForShape(
        "distinct",
        {
          ...table,
          columns: [{ ...columnDefaults, column: "uid", datatype: "string" }],
        },
        hllDialect,
      ),
    ).toEqual([]);
  });

  it("seeds inline filters for table changes, numerators, denominators, and funnel steps", () => {
    const ref = { factTableId: "old", column: "$$count", rowFilters: [] };
    expect(onFactTableChange(ref, table, hllDialect)).toMatchObject({
      factTableId: table.id,
      rowFilters: filters,
    });
    const numerator = applyFormType(
      { metricType: "funnel", numerator: null },
      "rowCount",
      table,
      hllDialect,
    ).numerator;
    expect(numerator).toMatchObject({
      factTableId: table.id,
      rowFilters: filters,
    });
    expect(
      applyFormType(current, "ratio", table, hllDialect).denominator
        ?.rowFilters,
    ).toEqual(filters);
    const steps = applyFormType(current, "funnel", table, hllDialect)
      .funnelSettings?.steps;
    expect(steps).toHaveLength(2);
    steps?.forEach((step) => expect(step.rowFilters).toEqual(filters));
    expect(onFactTableChange(ref, null, hllDialect)).toMatchObject({
      factTableId: "",
      rowFilters: [],
    });
  });

  it("uses count when a unit quantile shape cannot be recovered", () => {
    expect(
      onQuantileScopeChange(
        {
          factTableId: "ft1",
          column: "sketch",
          aggregation: "kll merge",
          rowFilters: [],
        },
        "unit",
        { ...factTable, columns: [] },
        hllDialect,
      ),
    ).toMatchObject({ column: "$$count", aggregation: undefined });
  });

  it("does not rewrite a ratio, quantile, or retention metric when its form type is unchanged", () => {
    const numerator = {
      factTableId: "ft1",
      column: "revenue",
      aggregation: "max" as const,
      aggregateFilterColumn: "$$count",
      aggregateFilter: ">= 3",
      rowFilters: [],
    };
    for (const metricType of ["ratio", "quantile", "retention"] as const) {
      const state = { metricType, numerator };
      expect(applyFormType(state, metricType, table, hllDialect)).toBe(state);
    }
    const threshold: MetricTypeSwitchState = {
      metricType: "proportion",
      numerator,
    };
    expect(
      applyFormType(threshold, "proportion", table, hllDialect).numerator
        ?.aggregateFilterColumn,
    ).toBeUndefined();
  });

  it("uses 25 hours for a day plus an hour and preserves fractional intervals", () => {
    const ws = {
      type: "conversion" as const,
      delayValue: 1,
      delayUnit: "days" as const,
      windowValue: 1,
      windowUnit: "hours" as const,
    };
    expect(retentionEnd(ws)).toBe(25);
    expect(
      onRetentionDelayOrModeChange(ws, { type: "end", value: 24.5 }),
    ).toMatchObject({
      delayValue: 24,
      windowValue: 0.5,
      delayUnit: "hours",
      windowUnit: "hours",
    });
    expect(
      normalizeRetentionWindow({
        ...ws,
        delayValue: 1,
        delayUnit: "hours",
        windowValue: 1,
        windowUnit: "days",
      }),
    ).toMatchObject({
      delayValue: 1,
      windowValue: 24,
      delayUnit: "hours",
      windowUnit: "hours",
    });
  });
});
