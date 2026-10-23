import { getRelativeEffectTelemetry } from "@/components/HomePage/ExperimentImpact/telemetry";

describe("getRelativeEffectTelemetry", () => {
  it("returns the relative effect and standard error for normal uplift", () => {
    expect(
      getRelativeEffectTelemetry({
        expected: 0.12,
        uplift: { dist: "normal", mean: 0.12, stddev: 0.03 },
      }),
    ).toEqual({
      relativeEffect: 0.12,
      relativeEffectStandardError: 0.03,
    });
  });

  it("uses expected instead of the log-scale mean for legacy Bayesian uplift", () => {
    expect(
      getRelativeEffectTelemetry({
        expected: Math.exp(0.12) - 1,
        uplift: { dist: "lognormal", mean: 0.12, stddev: 0.03 },
      }),
    ).toEqual({
      relativeEffect: Math.exp(0.12) - 1,
    });
  });

  it("omits both fields when the relative metric is missing", () => {
    expect(getRelativeEffectTelemetry()).toEqual({});
  });

  it("does not infer an effect from uplift when expected is missing", () => {
    expect(
      getRelativeEffectTelemetry({
        uplift: { dist: "normal", mean: 0, stddev: 0 },
      }),
    ).toEqual({});
  });

  it("preserves an observed zero relative effect", () => {
    expect(
      getRelativeEffectTelemetry({
        expected: 0,
        uplift: { dist: "normal", mean: 0, stddev: 0.02 },
      }),
    ).toEqual({
      relativeEffect: 0,
      relativeEffectStandardError: 0.02,
    });
  });
});
