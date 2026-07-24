import {
  validateCappingSettingsIgnoreZerosConsistency,
  validateCappingSettingsMetricTypeCompatibility,
} from "../../src/validators/fact-table";

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

describe("validateCappingSettingsIgnoreZerosConsistency", () => {
  const upperIgnore = {
    type: "percentile" as const,
    value: 0.99,
    ignoreZeros: true,
  };
  const upperKeep = {
    type: "percentile" as const,
    value: 0.99,
    ignoreZeros: false,
  };
  const lowerIgnore = {
    type: "percentile" as const,
    value: 0.01,
    ignoreZeros: true,
  };
  const lowerKeep = {
    type: "percentile" as const,
    value: 0.01,
    ignoreZeros: false,
  };

  it("allows both tails ignoring zeros", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, lowerIgnore),
    ).not.toThrow();
  });

  it("allows neither tail ignoring zeros", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperKeep, lowerKeep),
    ).not.toThrow();
  });

  it("treats missing ignoreZeros the same as false", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "percentile", value: 0.99 },
        { type: "percentile", value: 0.01, ignoreZeros: false },
      ),
    ).not.toThrow();
    // null on one side, undefined on the other → both effectively false.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "absolute", value: 15, ignoreZeros: null },
        { type: "absolute", value: 1 },
      ),
    ).not.toThrow();
  });

  it("rejects ignoring zeros on the upper tail only", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, lowerKeep),
    ).toThrow(/both capping tails or on neither/);
  });

  it("rejects ignoring zeros on the lower tail only", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperKeep, lowerIgnore),
    ).toThrow(/both capping tails or on neither/);
  });

  it("ignores the inactive tail's flag when only one tail caps", () => {
    // Upper capping only: a stale ignoreZeros on the (inactive) lower tail must
    // not trigger the mismatch error.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, {
        type: "none",
        value: 0,
        ignoreZeros: false,
      }),
    ).not.toThrow();
    // No lower tail at all.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, null),
    ).not.toThrow();
    // Lower capping only, with no upper tail configured.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "none", value: 0 },
        lowerIgnore,
      ),
    ).not.toThrow();
  });
});
