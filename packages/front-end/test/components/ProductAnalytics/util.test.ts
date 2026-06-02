import { describe, expect, it } from "vitest";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { ExplorationDataset } from "shared/validators";
import { getCommonColumns } from "@/enterprise/components/ProductAnalytics/util";

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
});
