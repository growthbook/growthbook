import {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import { ProductAnalyticsResultRow } from "shared/validators";
import {
  getDefaultFactMetricProps,
  toFactMetricFormValues,
} from "@/services/metrics";
import { getDraftMetricPreview } from "./draftMetricPreview";
import {
  getMetricPreviewConfig,
  getMetricPreviewDateRange,
  getMetricPreviewSummary,
  getMetricPreviewUnits,
  getMetricPreviewUnitLabel,
} from "./metricPreview";

const numerator = {
  factTableId: "ft1",
  column: "revenue",
  aggregation: "sum" as const,
  rowFilters: [],
};
function metric(): FactMetricInterface {
  const result = getDraftMetricPreview({
    ...toFactMetricFormValues(
      getDefaultFactMetricProps({
        datasources: [],
        settings: {},
        metricDefaults: {},
      }),
    ),
    metricType: "mean",
    datasource: "ds1",
    numerator,
  });
  if (!result) throw new Error("Invalid test metric");
  return result;
}
const rows: ProductAnalyticsResultRow[] = [
  {
    dimensions: ["2026-09-20"],
    values: [{ metricId: "metric", numerator: 200, denominator: 20 }],
  },
  {
    dimensions: ["2026-09-21"],
    values: [{ metricId: "metric", numerator: 400, denominator: 60 }],
  },
];

it("uses seven complete UTC days, including across month boundaries", () => {
  expect(getMetricPreviewDateRange(new Date("2026-10-03T13:15:00Z"))).toEqual({
    predefined: "customDateRange",
    startDate: "2026-09-26",
    endDate: "2026-10-02",
  });
});
it("uses a weighted per-unit average for mean metrics", () => {
  expect(
    getMetricPreviewSummary(rows, { metricType: "mean", numerator }),
  ).toMatchObject({
    value: 7.5,
    numerator: 600,
    denominator: 80,
    quotient: 7.5,
    label: "Average per unit-day",
  });
  expect(
    getMetricPreviewSummary(rows, {
      metricType: "mean",
      numerator: { ...numerator, column: "$$count", aggregation: undefined },
    })?.value,
  ).toBe(7.5);
});
it("uses a ratio of totals, not an average or sum of daily ratios", () => {
  expect(
    getMetricPreviewSummary(rows, { metricType: "ratio", numerator }),
  ).toMatchObject({
    value: 7.5,
    numerator: 600,
    denominator: 80,
    label: "Ratio of 7-day totals",
  });
});
it("uses the latest quantile and a weighted average for per-unit maxima", () => {
  const quantiles = rows.map((row) => ({
    ...row,
    values: row.values?.map((value) => ({ ...value, denominator: null })),
  }));
  expect(
    getMetricPreviewSummary(quantiles, { metricType: "quantile", numerator }),
  ).toMatchObject({
    value: 400,
    label: "Latest daily quantile",
    date: "2026-09-21",
  });
  expect(
    getMetricPreviewSummary(rows, {
      metricType: "mean",
      numerator: { ...numerator, aggregation: "max" },
    })?.value,
  ).toBe(7.5);
});
it("shows daily unit counts instead of a misleading proportion", () => {
  expect(
    getMetricPreviewSummary(rows, {
      metricType: "proportion",
      numerator: {
        ...numerator,
        column: "$$distinctUsers",
        aggregation: "max",
      },
    }),
  ).toMatchObject({
    value: 400,
    label: "Latest daily matching units",
    date: "2026-09-21",
  });
});
it("does not invent a value for absent data or a zero denominator", () => {
  expect(
    getMetricPreviewSummary([], { metricType: "ratio", numerator }),
  ).toBeNull();
  expect(
    getMetricPreviewSummary(
      [
        {
          dimensions: [],
          values: [{ metricId: "metric", numerator: 10, denominator: 0 }],
        },
      ],
      { metricType: "ratio", numerator },
    )?.value,
  ).toBeNull();
});
it("uses the selected numerator and denominator identifiers in the query", () => {
  const base = metric();
  const config = getMetricPreviewConfig(
    {
      ...base,
      metricType: "ratio",
      numerator,
      denominator: { ...numerator, factTableId: "ft2" },
      funnelSettings: null,
    },
    {
      draft: true,
      unit: "account_id",
      denominatorUnit: "device_id",
      dateRange: getMetricPreviewDateRange(),
    },
  );
  expect(config.dataset).toMatchObject({
    values: [
      {
        unit: "account_id",
        denominatorUnit: "device_id",
        draftMetric: { metricType: "ratio" },
      },
    ],
  });
});
it("offers only identifiers shared by all funnel steps", () => {
  const tables: Record<string, Pick<FactTableDefinition, "userIdTypes">> = {
    ft1: { userIdTypes: ["user_id", "account_id"] },
    ft2: { userIdTypes: ["account_id", "device_id"] },
  };
  const getTable = (id: string) => tables[id] ?? null;
  const step = {
    name: "Step",
    rowFilters: [],
    optional: false,
    conversionWindow: null,
  };
  const funnel: FactMetricInterface = {
    ...metric(),
    metricType: "funnel",
    numerator: null,
    funnelSettings: {
      steps: [
        { ...step, factTableId: "ft1" },
        { ...step, factTableId: "ft2" },
      ],
    },
  };
  expect(getMetricPreviewUnits(funnel, getTable)).toEqual({
    numerator: ["account_id"],
    denominator: [],
  });
  expect(
    getMetricPreviewConfig(funnel, {
      draft: true,
      unit: "account_id",
      denominatorUnit: null,
      dateRange: getMetricPreviewDateRange(),
    }).dataset,
  ).toMatchObject({ unit: "account_id" });
});

describe("getMetricPreviewUnitLabel", () => {
  it("prefers the display name of the mapped column", () => {
    expect(
      getMetricPreviewUnitLabel("user_id", {
        userIdColumns: { user_id: "customer_key" },
        columns: [{ column: "customer_key", name: "Members" }],
      }),
    ).toEqual({ label: "Members", column: "customer_key" });
  });
  it("uses common identifier names and preserves the raw column", () => {
    expect(getMetricPreviewUnitLabel("userId", null)).toEqual({
      label: "Users",
      column: "userId",
    });
    expect(
      getMetricPreviewUnitLabel("account_id", {
        columns: [],
        userIdColumns: { account_id: "properties.account" },
      }),
    ).toEqual({ label: "Accounts", column: "properties.account" });
  });
  it("humanizes unknown identifiers and ignores blank display names", () => {
    expect(
      getMetricPreviewUnitLabel("workspace_key", {
        columns: [{ column: "workspace_key", name: "  " }],
      }),
    ).toEqual({ label: "Workspace Key", column: "workspace_key" });
  });
});

it("finds the latest populated day regardless of row order", () => {
  expect(
    getMetricPreviewSummary([...rows].reverse(), {
      metricType: "quantile",
      numerator,
    }),
  ).toMatchObject({ value: 400, date: "2026-09-21" });
  expect(
    getMetricPreviewSummary(
      [
        ...rows,
        {
          dimensions: ["2026-09-22"],
          values: [{ metricId: "metric", numerator: null, denominator: null }],
        },
      ],
      { metricType: "proportion", numerator },
    ),
  ).toMatchObject({ value: 400, date: "2026-09-21" });
});
it("does not calculate an average with missing unit counts", () => {
  expect(
    getMetricPreviewSummary(
      [
        {
          dimensions: ["2026-09-21"],
          values: [{ metricId: "metric", numerator: 400, denominator: null }],
        },
      ],
      { metricType: "mean", numerator },
    )?.value,
  ).toBeNull();
});
it("uses the per-unit scale for mean metric charts", () => {
  expect(
    getMetricPreviewConfig(metric(), {
      draft: true,
      unit: "user_id",
      denominatorUnit: null,
      dateRange: getMetricPreviewDateRange(),
    }).showAs,
  ).toBe("per_unit");
});
