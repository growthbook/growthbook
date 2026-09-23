import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { capCoalesceValue } from "back-end/src/integrations/sql/primitives/cap-coalesce-value";
import { factMetricFactory } from "../../factories/FactMetric.factory";

// Statistics CTEs compute SUM(a * b) cross products (CUPED, ratio, event
// quantiles) from these values. Integer per-unit totals must be cast to float
// first, or the product overflows (e.g. BigQuery INT64 at ~9.2e18).
describe("capCoalesceValue", () => {
  const metric = factMetricFactory.build({
    id: "fact_count",
    metricType: "mean",
    numerator: { factTableId: "ft", column: "$$count", aggregation: "sum" },
  });

  it("casts uncapped values to float on BigQuery", () => {
    expect(
      capCoalesceValue(bigQueryDialect, { valueCol: "m.value", metric }),
    ).toBe("CAST(COALESCE(m.value, 0) AS FLOAT64)");
  });

  it("casts uncapped values to float on other dialects", () => {
    expect(
      capCoalesceValue(postgresDialect, { valueCol: "m.value", metric }),
    ).toBe("COALESCE(m.value, 0)::float");
  });

  it("keeps the original type when preserveType is set", () => {
    // Covariate caches persist into typed (possibly INT64) columns, and
    // BigQuery rejects inserting FLOAT64 into an INT64 column.
    expect(
      capCoalesceValue(bigQueryDialect, {
        valueCol: "m.value",
        metric,
        preserveType: true,
      }),
    ).toBe("COALESCE(m.value, 0)");
  });

  it("casts capped values to float on BigQuery", () => {
    const capped = {
      ...metric,
      cappingSettings: { type: "absolute" as const, value: 100 },
    };
    expect(
      capCoalesceValue(bigQueryDialect, {
        valueCol: "m.value",
        metric: capped,
      }),
    ).toContain("CAST(COALESCE(m.value, 0) AS FLOAT64)");
  });
});
