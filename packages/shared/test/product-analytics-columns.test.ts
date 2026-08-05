import { getAvailableDimensionColumns } from "shared/enterprise";
import {
  ColumnInterface,
  FactTableInterface,
  FactMetricInterface,
} from "shared/types/fact-table";

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

function makeFactTable(
  overrides: Partial<FactTableInterface> & {
    id: string;
    columns: ColumnInterface[];
  },
): FactTableInterface {
  return {
    datasource: "ds_1",
    filters: [],
    name: overrides.id,
    organization: "org_1",
    sql: "SELECT * FROM t",
    userIdTypes: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    description: "",
    eventName: "",
    owner: "",
    projects: [],
    tags: [],
    ...overrides,
  } as FactTableInterface;
}

const numeratorFt = makeFactTable({
  id: "numerator_ft",
  userIdTypes: ["user_id"],
  columns: [
    makeColumn({ column: "user_id", datatype: "string" }),
    makeColumn({ column: "country", name: "Country", datatype: "string" }),
    makeColumn({ column: "amount", datatype: "number" }),
    makeColumn({ column: "deleted_col", datatype: "string", deleted: true }),
    makeColumn({
      column: "props",
      name: "Props",
      datatype: "json",
      jsonFields: {
        plan: { datatype: "string" },
        score: { datatype: "number" },
      },
    }),
  ],
});

function makeMetric(
  overrides: Partial<FactMetricInterface> & { id: string },
): FactMetricInterface {
  return {
    name: overrides.id,
    metricType: "mean",
    numerator: {
      factTableId: "numerator_ft",
      column: "amount",
      aggregation: "sum",
    },
    denominator: null,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "",
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
    quantileSettings: null,
    ...overrides,
  } as FactMetricInterface;
}

describe("getAvailableDimensionColumns", () => {
  it("returns [] for a null dataset", () => {
    expect(
      getAvailableDimensionColumns(
        null,
        () => null,
        () => null,
      ),
    ).toEqual([]);
  });

  it("returns [] for a metric dataset with no values", () => {
    expect(
      getAvailableDimensionColumns(
        { type: "metric", values: [] },
        () => null,
        () => null,
      ),
    ).toEqual([]);
  });

  it("lists string columns and dotted JSON sub-paths for a fact_table dataset, excluding deleted columns and userIdTypes", () => {
    const getFactTableById = (id: string) =>
      id === "numerator_ft" ? numeratorFt : null;

    const result = getAvailableDimensionColumns(
      {
        type: "fact_table",
        factTableId: "numerator_ft",
        values: [{ name: "v", valueColumn: "amount", rowFilters: [] }],
      },
      getFactTableById,
      () => null,
    );

    expect(result.map((c) => c.column).sort()).toEqual([
      "country",
      "props.plan",
    ]);
  });

  it("intersects columns across multiple metric values in a metric dataset", () => {
    const otherFt = makeFactTable({
      id: "other_ft",
      columns: [
        makeColumn({ column: "country", name: "Country", datatype: "string" }),
      ],
    });
    const getFactTableById = (id: string) =>
      ({ numerator_ft: numeratorFt, other_ft: otherFt })[id] ?? null;
    const getFactMetricById = (id: string) =>
      ({
        m1: makeMetric({
          id: "m1",
          numerator: {
            factTableId: "numerator_ft",
            column: "amount",
            aggregation: "sum",
          },
        }),
        m2: makeMetric({
          id: "m2",
          numerator: {
            factTableId: "other_ft",
            column: "$$count",
            aggregation: "sum",
          },
        }),
      })[id] ?? null;

    const result = getAvailableDimensionColumns(
      {
        type: "metric",
        values: [
          {
            name: "v1",
            type: "metric",
            rowFilters: [],
            metricId: "m1",
            unit: null,
            denominatorUnit: null,
          },
          {
            name: "v2",
            type: "metric",
            rowFilters: [],
            metricId: "m2",
            unit: null,
            denominatorUnit: null,
          },
        ],
      },
      getFactTableById,
      getFactMetricById,
    );

    // Only "country" is common to both metrics' fact tables — the numerator-
    // only "props.plan" is dropped by the cross-metric intersection.
    expect(result.map((c) => c.column)).toEqual(["country"]);
  });

  describe("ratio metric denominator resolvability", () => {
    it("excludes a nested JSON column the denominator's fact table doesn't share", () => {
      const denominatorFt = makeFactTable({
        id: "denominator_ft",
        columns: [
          makeColumn({
            column: "country",
            name: "Country",
            datatype: "string",
          }),
          // No "props" column at all.
        ],
      });
      const getFactTableById = (id: string) =>
        ({ numerator_ft: numeratorFt, denominator_ft: denominatorFt })[id] ??
        null;
      const getFactMetricById = () =>
        makeMetric({
          id: "ratio",
          metricType: "ratio",
          numerator: {
            factTableId: "numerator_ft",
            column: "amount",
            aggregation: "sum",
          },
          denominator: {
            factTableId: "denominator_ft",
            column: "$$count",
            aggregation: "sum",
          },
        });

      const result = getAvailableDimensionColumns(
        {
          type: "metric",
          values: [
            {
              name: "v",
              type: "metric",
              rowFilters: [],
              metricId: "ratio",
              unit: null,
              denominatorUnit: null,
            },
          ],
        },
        getFactTableById,
        getFactMetricById,
      );

      expect(result.map((c) => c.column)).toEqual(["country"]);
    });

    it("includes a nested JSON column when the denominator's fact table shares the same field", () => {
      const denominatorFt = makeFactTable({
        id: "denominator_ft",
        columns: [
          makeColumn({
            column: "country",
            name: "Country",
            datatype: "string",
          }),
          makeColumn({
            column: "props",
            name: "Props",
            datatype: "json",
            jsonFields: { plan: { datatype: "string" } },
          }),
        ],
      });
      const getFactTableById = (id: string) =>
        ({ numerator_ft: numeratorFt, denominator_ft: denominatorFt })[id] ??
        null;
      const getFactMetricById = () =>
        makeMetric({
          id: "ratio",
          metricType: "ratio",
          numerator: {
            factTableId: "numerator_ft",
            column: "amount",
            aggregation: "sum",
          },
          denominator: {
            factTableId: "denominator_ft",
            column: "$$count",
            aggregation: "sum",
          },
        });

      const result = getAvailableDimensionColumns(
        {
          type: "metric",
          values: [
            {
              name: "v",
              type: "metric",
              rowFilters: [],
              metricId: "ratio",
              unit: null,
              denominatorUnit: null,
            },
          ],
        },
        getFactTableById,
        getFactMetricById,
      );

      expect(result.map((c) => c.column).sort()).toEqual([
        "country",
        "props.plan",
      ]);
    });
  });

  it("lists only string-typed columns for a data_source dataset", () => {
    const result = getAvailableDimensionColumns(
      {
        type: "data_source",
        path: "raw_events",
        timestampColumn: "ts",
        columnTypes: { country: "string", amount: "number", ts: "date" },
        values: [{ name: "v", valueColumn: "amount", rowFilters: [] }],
      },
      () => null,
      () => null,
    );

    expect(result.map((c) => c.column)).toEqual(["country"]);
  });

  it("uses the initial step's fact table for a funnel dataset", () => {
    const getFactTableById = (id: string) =>
      id === "numerator_ft" ? numeratorFt : null;

    const result = getAvailableDimensionColumns(
      {
        type: "funnel",
        unit: "user_id",
        steps: [{ name: "s1", factTable: "numerator_ft", rowFilters: [] }],
      },
      getFactTableById,
      () => null,
    );

    expect(result.map((c) => c.column).sort()).toEqual([
      "country",
      "props.plan",
    ]);
  });
});
