import { describe, expect, it } from "vitest";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { ExplorationConfig, ExplorationDataset } from "shared/validators";
import {
  getCommonColumns,
  getColumnTopValues,
  getRelevantFactTableIds,
  validateDimensions,
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

  it("drops a dimension when the fact table can't be resolved at all, by default", () => {
    const config = makeConfig([
      { dimensionType: "static", column: "country", values: ["US"] },
    ]);

    expect(
      validateDimensions(config, () => null, noFactMetric).dimensions,
    ).toEqual([]);
  });

  it("keeps a dimension when the fact table can't be resolved yet, but columnsMayBeIncomplete is set", () => {
    const config = makeConfig([
      { dimensionType: "static", column: "country", values: ["US"] },
    ]);

    expect(
      validateDimensions(config, () => null, noFactMetric, {
        columnsMayBeIncomplete: true,
      }).dimensions,
    ).toEqual(config.dimensions);
  });
});

describe("getRelevantFactTableIds", () => {
  it("returns [] for a null dataset", () => {
    expect(getRelevantFactTableIds(null, noFactMetric)).toEqual([]);
  });

  it("returns the fact table id for a fact_table dataset", () => {
    expect(getRelevantFactTableIds(factTableDataset(), noFactMetric)).toEqual([
      "ft_1",
    ]);
  });

  it("returns numerator and denominator fact table ids for a ratio metric dataset", () => {
    const getFactMetricById = (id: string) =>
      ({
        m1: {
          numerator: { factTableId: "numerator_ft" },
          denominator: { factTableId: "denominator_ft" },
        } as FactMetricInterface,
      })[id] ?? null;

    const dataset: ExplorationDataset = {
      type: "metric",
      values: [
        {
          name: "v",
          type: "metric",
          rowFilters: [],
          metricId: "m1",
          unit: null,
          denominatorUnit: null,
        },
      ],
    };

    expect(getRelevantFactTableIds(dataset, getFactMetricById).sort()).toEqual([
      "denominator_ft",
      "numerator_ft",
    ]);
  });

  it("returns only the initial step's fact table for a funnel dataset", () => {
    const dataset: ExplorationDataset = {
      type: "funnel",
      unit: "user_id",
      steps: [
        {
          name: "s1",
          factTable: "step1_ft",
          rowFilters: [],
          optional: false,
        },
        {
          name: "s2",
          factTable: "step2_ft",
          rowFilters: [],
          optional: false,
        },
      ],
    };

    expect(getRelevantFactTableIds(dataset, noFactMetric)).toEqual([
      "step1_ft",
    ]);
  });
});
