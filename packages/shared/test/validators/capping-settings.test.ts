import { validateCappingSettingsMetricTypeCompatibility } from "../../src/validators/fact-table";

describe("validateCappingSettingsMetricTypeCompatibility", () => {
  const percentileUpper = { type: "percentile" as const, value: 0.99 };
  const percentileLower = { type: "percentile" as const, value: 0.01 };
  const absoluteUpper = { type: "absolute" as const, value: 15.78923 };
  const absoluteLower = { type: "absolute" as const, value: 10.19583 };

  it("allows percentile capping on both tails for ratio metrics", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        percentileUpper,
        percentileLower,
      ),
    ).not.toThrow();
  });

  it("allows uncapped ratio metrics", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        { type: "", value: 0 },
        null,
      ),
    ).not.toThrow();
  });

  it("rejects an absolute upper cap on a ratio metric", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        absoluteUpper,
        null,
      ),
    ).toThrow(/Ratio metrics support only percentile capping/);
  });

  it("rejects an absolute lower cap on a ratio metric", () => {
    // Regression: this is the shape found on fact__2CdFPYWVC8mgxjSBDWqhCL.
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        percentileUpper,
        absoluteLower,
      ),
    ).toThrow(/Ratio metrics support only percentile capping/);
  });

  it("rejects absolute caps on both tails of a ratio metric", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        absoluteUpper,
        absoluteLower,
      ),
    ).toThrow(/Ratio metrics support only percentile capping/);
  });

  it("allows absolute capping for non-ratio metric types", () => {
    for (const metricType of ["mean", "proportion", "retention"]) {
      expect(() =>
        validateCappingSettingsMetricTypeCompatibility(
          metricType,
          absoluteUpper,
          absoluteLower,
        ),
      ).not.toThrow();
    }
  });

  it("treats 'none'/empty tail types as not absolute", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        { type: "none", value: 0 },
        { type: "", value: 0 },
      ),
    ).not.toThrow();
  });
});
