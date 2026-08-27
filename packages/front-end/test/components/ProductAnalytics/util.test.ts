import { describe, expect, it } from "vitest";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  ExplorationConfig,
  ExplorationDataset,
  SqlDataset,
} from "shared/validators";
import {
  applyTimestampColumn,
  getCommonColumns,
  getColumnTopValues,
  normalizeTimelessSqlConfig,
  resolveSqlPreviewTimestamp,
  validateDimensions,
  type ExplorerDraftConfig,
} from "@/enterprise/components/ProductAnalytics/util";

function makeColumn(overrides: Partial<ColumnInterface>): ColumnInterface {
  return {
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "",
    description: "",
    column: "",
    datatype: "string",
    numberFormat: "",
    deleted: false,
    ...overrides,
  };
}

// getCommonColumns only reads `columns` and `userIdTypes` off the fact table.
function makeFactTable(
  columns: ColumnInterface[],
  userIdTypes: string[] = [],
): FactTableInterface {
  return { columns, userIdTypes } as FactTableInterface;
}

function factTableDataset(): ExplorationDataset {
  return {
    type: "fact_table",
    factTableId: "ft_1",
    values: [
      {
        type: "fact_table",
        name: "value",
        rowFilters: [],
        valueType: "count",
        valueColumn: null,
        unit: null,
      },
    ],
  };
}

const noFactMetric = () => null;

describe("getCommonColumns", () => {
  it("returns empty when dataset is null", () => {
    expect(getCommonColumns(null, () => null, noFactMetric)).toEqual([]);
  });

  it("returns empty when the dataset has no values", () => {
    const dataset: ExplorationDataset = {
      type: "fact_table",
      factTableId: "ft_1",
      values: [],
    };
    expect(getCommonColumns(dataset, () => null, noFactMetric)).toEqual([]);
  });

  it("includes only top-level string columns, sorted by name", () => {
    const ft = makeFactTable([
      makeColumn({ column: "country", name: "Country", datatype: "string" }),
      makeColumn({ column: "age", name: "Age", datatype: "number" }),
      makeColumn({ column: "signup", name: "Signup", datatype: "date" }),
      makeColumn({ column: "browser", name: "Browser", datatype: "string" }),
    ]);

    expect(
      getCommonColumns(factTableDataset(), () => ft, noFactMetric),
    ).toEqual([
      { column: "browser", name: "Browser" },
      { column: "country", name: "Country" },
    ]);
  });

  it("excludes deleted columns and userIdType columns", () => {
    const ft = makeFactTable(
      [
        makeColumn({ column: "country", name: "Country" }),
        makeColumn({ column: "old", name: "Old", deleted: true }),
        makeColumn({ column: "user_id", name: "User ID" }),
      ],
      ["user_id"],
    );

    expect(
      getCommonColumns(factTableDataset(), () => ft, noFactMetric),
    ).toEqual([{ column: "country", name: "Country" }]);
  });

  it("expands string JSON fields into dot-notation columns", () => {
    const ft = makeFactTable([
      makeColumn({ column: "country", name: "Country", datatype: "string" }),
      makeColumn({
        column: "props",
        name: "Props",
        datatype: "json",
        jsonFields: {
          plan: { datatype: "string" },
          age: { datatype: "number" },
          city: { datatype: "string" },
        },
      }),
    ]);

    expect(
      getCommonColumns(factTableDataset(), () => ft, noFactMetric),
    ).toEqual([
      { column: "country", name: "Country" },
      { column: "props.city", name: "Props.city" },
      { column: "props.plan", name: "Props.plan" },
    ]);
  });

  it("does not expand JSON fields on non-json columns", () => {
    const ft = makeFactTable([
      // jsonFields present but datatype is string, so it is treated as a
      // plain string column and the fields are ignored.
      makeColumn({
        column: "country",
        name: "Country",
        datatype: "string",
        jsonFields: { nested: { datatype: "string" } },
      }),
    ]);

    expect(
      getCommonColumns(factTableDataset(), () => ft, noFactMetric),
    ).toEqual([{ column: "country", name: "Country" }]);
  });

  it("falls back to the column id when a JSON column has no name", () => {
    const ft = makeFactTable([
      makeColumn({
        column: "props",
        name: "",
        datatype: "json",
        jsonFields: { plan: { datatype: "string" } },
      }),
    ]);

    expect(
      getCommonColumns(factTableDataset(), () => ft, noFactMetric),
    ).toEqual([{ column: "props.plan", name: "props.plan" }]);
  });

  it("maps data_source columnTypes to string columns", () => {
    const dataset: ExplorationDataset = {
      type: "data_source",
      table: "events",
      path: "",
      timestampColumn: "ts",
      columnTypes: {
        country: "string",
        age: "number",
        signup: "date",
      },
      values: [
        {
          type: "data_source",
          name: "value",
          rowFilters: [],
          valueType: "count",
          valueColumn: null,
          unit: null,
        },
      ],
    };

    expect(getCommonColumns(dataset, () => null, noFactMetric)).toEqual([
      { column: "country", name: "country" },
    ]);
  });

  it("intersects columns across multiple metrics in a metric dataset", () => {
    const dataset: ExplorationDataset = {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "a",
          rowFilters: [],
          metricId: "met_a",
          unit: null,
          denominatorUnit: null,
        },
        {
          type: "metric",
          name: "b",
          rowFilters: [],
          metricId: "met_b",
          unit: null,
          denominatorUnit: null,
        },
      ],
    };

    const ftA = makeFactTable([
      makeColumn({ column: "country", name: "Country" }),
      makeColumn({ column: "browser", name: "Browser" }),
    ]);
    const ftB = makeFactTable([
      makeColumn({ column: "country", name: "Country" }),
      makeColumn({ column: "device", name: "Device" }),
    ]);

    const getFactTableById = (id: string) =>
      id === "ft_a" ? ftA : id === "ft_b" ? ftB : null;
    const getFactMetricById = (id: string) =>
      ({
        numerator: { factTableId: id === "met_a" ? "ft_a" : "ft_b" },
      }) as FactMetricInterface;

    expect(
      getCommonColumns(dataset, getFactTableById, getFactMetricById),
    ).toEqual([{ column: "country", name: "Country" }]);
  });

  it("excludes columns a ratio metric's denominator table can't resolve", () => {
    const dataset: ExplorationDataset = {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "a",
          rowFilters: [],
          metricId: "met_a",
          unit: null,
          denominatorUnit: null,
        },
      ],
    };

    const numeratorFt = makeFactTable([
      makeColumn({ column: "country", name: "Country" }),
      makeColumn({ column: "browser", name: "Browser" }),
    ]);
    const denominatorFt = makeFactTable([
      makeColumn({ column: "country", name: "Country" }),
    ]);

    const getFactTableById = (id: string) =>
      id === "ft_numerator"
        ? numeratorFt
        : id === "ft_denominator"
          ? denominatorFt
          : null;
    const getFactMetricById = () =>
      ({
        numerator: { factTableId: "ft_numerator" },
        denominator: { factTableId: "ft_denominator" },
      }) as FactMetricInterface;

    expect(
      getCommonColumns(dataset, getFactTableById, getFactMetricById),
    ).toEqual([{ column: "country", name: "Country" }]);
  });
});

describe("getColumnTopValues", () => {
  it("returns empty when dataset or column is missing", () => {
    const ft = makeFactTable([
      makeColumn({ column: "country", topValues: ["US", "CA"] }),
    ]);
    expect(getColumnTopValues(null, "country", () => ft, noFactMetric)).toEqual(
      [],
    );
    expect(
      getColumnTopValues(factTableDataset(), null, () => ft, noFactMetric),
    ).toEqual([]);
  });

  it("reads cached top values off the fact table for a fact_table dataset", () => {
    const ft = makeFactTable([
      makeColumn({ column: "country", topValues: ["US", "CA"] }),
    ]);
    expect(
      getColumnTopValues(factTableDataset(), "country", () => ft, noFactMetric),
    ).toEqual(["US", "CA"]);
  });

  it("returns empty for a data_source dataset (no cached column metadata)", () => {
    const dataset: ExplorationDataset = {
      type: "data_source",
      table: "events",
      path: "events",
      timestampColumn: "timestamp",
      columnTypes: { country: "string" },
      values: [
        {
          type: "data_source",
          name: "value",
          rowFilters: [],
          valueType: "count",
          valueColumn: null,
          unit: null,
        },
      ],
    };
    expect(
      getColumnTopValues(dataset, "country", () => null, noFactMetric),
    ).toEqual([]);
  });

  it("unions top values across every metric's fact table for a metric dataset", () => {
    const dataset: ExplorationDataset = {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "a",
          rowFilters: [],
          metricId: "met_a",
          unit: null,
          denominatorUnit: null,
        },
        {
          type: "metric",
          name: "b",
          rowFilters: [],
          metricId: "met_b",
          unit: null,
          denominatorUnit: null,
        },
      ],
    };

    const ftA = makeFactTable([
      makeColumn({ column: "country", topValues: ["US", "CA"] }),
    ]);
    const ftB = makeFactTable([
      makeColumn({ column: "country", topValues: ["CA", "MX"] }),
    ]);

    const getFactTableById = (id: string) =>
      id === "ft_a" ? ftA : id === "ft_b" ? ftB : null;
    const getFactMetricById = (id: string) =>
      ({
        numerator: { factTableId: id === "met_a" ? "ft_a" : "ft_b" },
      }) as FactMetricInterface;

    expect(
      getColumnTopValues(
        dataset,
        "country",
        getFactTableById,
        getFactMetricById,
      ).sort(),
    ).toEqual(["CA", "MX", "US"]);
  });
});

describe("validateDimensions", () => {
  function makeConfig(
    dimensions: ExplorationConfig["dimensions"],
  ): ExplorationConfig {
    return {
      type: "fact_table",
      datasource: "ds_1",
      dataset: {
        type: "fact_table",
        factTableId: "ft_1",
        values: [
          {
            type: "fact_table",
            name: "value",
            rowFilters: [],
            valueType: "count",
            valueColumn: null,
            unit: null,
          },
        ],
      },
      dimensions,
      chartType: "bar",
      dateRange: { predefined: "last7Days" },
    };
  }

  it("keeps a static dimension pinned on a JSON dot-notation column", () => {
    const ft = makeFactTable([
      makeColumn({
        column: "props",
        name: "Props",
        datatype: "json",
        jsonFields: { plan: { datatype: "string" } },
      }),
    ]);
    const config = makeConfig([
      { dimensionType: "static", column: "props.plan", values: ["pro"] },
    ]);

    expect(
      validateDimensions(config, () => ft, noFactMetric).dimensions,
    ).toEqual(config.dimensions);
  });

  it("keeps a dynamic dimension pinned on a JSON dot-notation column", () => {
    const ft = makeFactTable([
      makeColumn({
        column: "props",
        name: "Props",
        datatype: "json",
        jsonFields: { plan: { datatype: "string" } },
      }),
    ]);
    const config = makeConfig([
      { dimensionType: "dynamic", column: "props.plan", maxValues: 5 },
    ]);

    expect(
      validateDimensions(config, () => ft, noFactMetric).dimensions,
    ).toEqual(config.dimensions);
  });

  it("drops a dimension whose column no longer exists on the fact table", () => {
    const ft = makeFactTable([
      makeColumn({ column: "country", name: "Country" }),
    ]);
    const config = makeConfig([
      { dimensionType: "static", column: "removed_column", values: ["x"] },
    ]);

    expect(
      validateDimensions(config, () => ft, noFactMetric).dimensions,
    ).toEqual([]);
  });
});

describe("applyTimestampColumn", () => {
  function sqlDraft(
    overrides: Omit<Partial<ExplorerDraftConfig>, "dataset"> & {
      dataset?: Partial<SqlDataset>;
    } = {},
  ): ExplorerDraftConfig {
    return {
      type: "sql",
      datasource: "ds_1",
      chartType: "line",
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [
        {
          dimensionType: "date",
          column: "date",
          dateGranularity: "auto",
        },
      ],
      ...overrides,
      dataset: {
        type: "sql",
        sql: "SELECT 1",
        timestampColumn: "created_at",
        columnTypes: { created_at: "date" },
        values: [],
        ...(overrides.dataset ?? {}),
      },
    } as ExplorerDraftConfig;
  }

  it("defaults bar/table to a line chart and adds a date dimension when a timestamp appears", () => {
    const config = sqlDraft({
      chartType: "bar",
      dimensions: [],
      dataset: { timestampColumn: null },
    });
    const next = applyTimestampColumn(config, "created_at");
    expect(next.chartType).toBe("line");
    expect(next.dimensions[0]).toEqual({
      dimensionType: "date",
      column: "date",
      dateGranularity: "auto",
    });
    expect(
      next.dataset.type === "sql" ? next.dataset.timestampColumn : null,
    ).toBe("created_at");
  });

  it("resets a line chart, date dimension, and comparison window when the timestamp is cleared", () => {
    const config = sqlDraft({
      previousTimeFrame: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      comparisonMode: "previousPeriod",
    });
    const next = applyTimestampColumn(config, null);
    expect(next.chartType).toBe("bar");
    expect(next.dimensions).toEqual([]);
    expect(next.previousTimeFrame).toBeUndefined();
    expect(next.comparisonMode).toBeUndefined();
    expect(
      next.dataset.type === "sql" ? next.dataset.timestampColumn : null,
    ).toBe(null);
  });

  it("returns the same reference when a timeless config is already clean", () => {
    const config = sqlDraft({
      chartType: "bar",
      dimensions: [],
      dataset: { timestampColumn: null },
    });
    expect(normalizeTimelessSqlConfig(config)).toBe(config);
  });
});

describe("resolveSqlPreviewTimestamp", () => {
  it("keeps a still-valid manual timestamp pick", () => {
    expect(
      resolveSqlPreviewTimestamp({
        previousTimestamp: "event_at",
        previousColumnTypes: { event_at: "date", created_at: "date" },
        columnTypes: { event_at: "date", created_at: "date" },
        inferredTimestamp: "created_at",
      }),
    ).toBe("event_at");
  });

  it("infers a timestamp when date columns newly appear", () => {
    expect(
      resolveSqlPreviewTimestamp({
        previousTimestamp: null,
        previousColumnTypes: { event_name: "string" },
        columnTypes: { event_name: "string", created_at: "date" },
        inferredTimestamp: "created_at",
      }),
    ).toBe("created_at");
  });

  it("clears the timestamp when the new results have no date columns", () => {
    expect(
      resolveSqlPreviewTimestamp({
        previousTimestamp: "created_at",
        previousColumnTypes: { created_at: "date" },
        columnTypes: { event_name: "string" },
        inferredTimestamp: null,
      }),
    ).toBe(null);
  });

  it("preserves explicit None while date columns still exist", () => {
    expect(
      resolveSqlPreviewTimestamp({
        previousTimestamp: null,
        previousColumnTypes: { created_at: "date" },
        columnTypes: { created_at: "date", event_at: "date" },
        inferredTimestamp: "created_at",
      }),
    ).toBe(null);
  });
});
