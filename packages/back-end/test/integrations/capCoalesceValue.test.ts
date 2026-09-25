import { SqlDialect } from "shared/types/sql";
import { capCoalesceValue } from "back-end/src/integrations/sql/primitives/cap-coalesce-value";
import { factMetricFactory } from "../factories/FactMetric.factory";

// Minimal dialect stub: capCoalesceValue only uses castToFloat.
const dialect = {
  castToFloat: (s: string) => `CAST(${s} AS FLOAT)`,
} as unknown as SqlDialect;

describe("capCoalesceValue", () => {
  it("caps at the upper bound when only an upper percentile cap is set", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      cappingSettings: { type: "percentile", value: 0.99, ignoreZeros: false },
      lowerCappingSettings: null,
    });
    const sql = capCoalesceValue(dialect, { valueCol: "m.value", metric });
    expect(sql).toBe("LEAST(CAST(COALESCE(m.value, 0) AS FLOAT), c.value_cap)");
  });

  it("applies the absolute cap OUTERMOST for mixed-type tails (absolute lower + percentile upper)", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      cappingSettings: { type: "percentile", value: 0.99, ignoreZeros: false },
      lowerCappingSettings: { type: "absolute", value: 5, ignoreZeros: false },
    });
    const sql = capCoalesceValue(dialect, { valueCol: "m.value", metric });
    // Percentile upper cap is applied inner, absolute lower cap outer, so a
    // crossed threshold collapses every value to the absolute bound (5).
    expect(sql).toBe(
      "GREATEST(LEAST(CAST(COALESCE(m.value, 0) AS FLOAT), c.value_cap), 5)",
    );
  });

  it("applies the absolute cap OUTERMOST for mixed-type tails (absolute upper + percentile lower)", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      cappingSettings: { type: "absolute", value: 100, ignoreZeros: false },
      lowerCappingSettings: {
        type: "percentile",
        value: 0.05,
        ignoreZeros: false,
      },
    });
    const sql = capCoalesceValue(dialect, { valueCol: "m.value", metric });
    // Percentile lower cap is applied inner, absolute upper cap outer, so a
    // crossed threshold collapses every value to the absolute bound (100).
    expect(sql).toBe(
      "LEAST(GREATEST(CAST(COALESCE(m.value, 0) AS FLOAT), c.value_cap_lower), 100)",
    );
  });

  it("leaves a lower-only bound unclamped when there is no upper bound", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      cappingSettings: { type: "", value: 0, ignoreZeros: false },
      lowerCappingSettings: { type: "absolute", value: 5, ignoreZeros: false },
    });
    const sql = capCoalesceValue(dialect, { valueCol: "m.value", metric });
    expect(sql).toBe("GREATEST(CAST(COALESCE(m.value, 0) AS FLOAT), 5)");
  });
});
