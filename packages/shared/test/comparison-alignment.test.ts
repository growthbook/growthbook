import type { ProductAnalyticsResultRow } from "shared/validators";
import {
  buildAlignedComparisonRowLookup,
  createComparisonAlignmentResolver,
  explorerDimensionDateToUtcYyyyMmDd,
} from "shared/enterprise";

describe("explorerDimensionDateToUtcYyyyMmDd", () => {
  it("normalizes date-only and ISO-with-time to the same UTC calendar day", () => {
    expect(explorerDimensionDateToUtcYyyyMmDd("2024-06-01")).toBe(
      explorerDimensionDateToUtcYyyyMmDd("2024-06-01T18:30:00.000Z"),
    );
  });
});

describe("buildAlignedComparisonRowLookup", () => {
  const row = (dim: string, n: number): ProductAnalyticsResultRow => ({
    dimensions: [dim],
    values: [
      {
        metricId: "m1",
        numerator: n,
        denominator: null,
      },
    ],
  });

  it("pairs sparse primary rows to YoY comparison buckets when present", () => {
    const primary: ProductAnalyticsResultRow[] = [
      row("2024-01-05", 10),
      row("2024-01-07", 20),
    ];
    const comparison: ProductAnalyticsResultRow[] = [
      row("2023-01-01T00:00:00.000Z", 1),
      row("2023-01-05T00:00:00.000Z", 99),
      row("2023-01-07T00:00:00.000Z", 88),
    ];
    const lookup = buildAlignedComparisonRowLookup(primary, comparison, true);
    expect(lookup("2024-01-05")?.values[0]?.numerator).toBe(99);
    expect(lookup("2024-01-07")?.values[0]?.numerator).toBe(88);
  });

  it("falls back to chronological rank when YoY calendar bucket is missing", () => {
    const primary: ProductAnalyticsResultRow[] = [
      row("2024-01-05", 10),
      row("2024-01-06", 20),
    ];
    const comparison: ProductAnalyticsResultRow[] = [
      row("2024-01-01", 100),
      row("2024-01-02", 200),
    ];
    const lookup = buildAlignedComparisonRowLookup(primary, comparison, true);
    expect(lookup("2024-01-05")?.values[0]?.numerator).toBe(100);
    expect(lookup("2024-01-06")?.values[0]?.numerator).toBe(200);
  });
});

describe("createComparisonAlignmentResolver", () => {
  it("returns undefined when current key is unknown to the rank map", () => {
    const resolver = createComparisonAlignmentResolver(
      ["2024-01-01"],
      ["2023-01-01"],
      true,
    );
    expect(resolver("2099-12-31")).toBeUndefined();
  });
});
