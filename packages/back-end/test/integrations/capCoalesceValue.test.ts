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

  it("clamps the lower bound to the upper bound for mixed-type tails (absolute lower + percentile upper)", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      cappingSettings: { type: "percentile", value: 0.99, ignoreZeros: false },
      lowerCappingSettings: { type: "absolute", value: 5, ignoreZeros: false },
    });
    const sql = capCoalesceValue(dialect, { valueCol: "m.value", metric });
    // The lower absolute bound (5) is clamped to at most the upper percentile
    // cap column so a crossed threshold degrades to "capped at the upper bound"
    // instead of collapsing every row to the floor.
    expect(sql).toBe(
      "GREATEST(LEAST(CAST(COALESCE(m.value, 0) AS FLOAT), c.value_cap), LEAST(5, c.value_cap))",
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
