import { decisionMakingConditions } from "../../src/utils/decisionMaking";
import {
  DEFAULT_METRIC_SETTINGS,
  DEFAULT_ANALYSIS_SETTINGS,
} from "../../src/models/settings";

describe("decisionMakingConditions", () => {
  it("returns true for goal metric with relative difference and no dimension", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "goal",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(true);
  });

  it("returns false when businessMetricType is missing", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: undefined,
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });

  it("returns false for guardrail metric", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "guardrail",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });

  it("returns false for absolute difference type", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "goal",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "absolute" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });

  it("returns false when dimension is set", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "goal",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "country",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });
});
