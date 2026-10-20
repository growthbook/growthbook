import { findAnalysisComputeFailure, isAnalysisAllowed } from "../../src/util";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";

describe("isAnalysisAllowed", () => {
  const baseSnapshotSettings = {
    dimensions: [{ id: "precomputed:country" }],
    regressionAdjustmentEnabled: false,
  } as ExperimentSnapshotSettings;

  const baseAnalysisSettings = {
    dimensions: [],
    regressionAdjusted: false,
  } as ExperimentSnapshotAnalysisSettings;

  it("allows precomputed unit dimensions from snapshot settings", () => {
    expect(
      isAnalysisAllowed(
        {
          ...baseSnapshotSettings,
          precomputedUnitDimensionIds: ["dim_country"],
        },
        {
          ...baseAnalysisSettings,
          dimensions: ["dim_country"],
        },
      ),
    ).toBe(true);
  });

  it("rejects dimensions that were not computed by the snapshot", () => {
    expect(
      isAnalysisAllowed(baseSnapshotSettings, {
        ...baseAnalysisSettings,
        dimensions: ["dim_country"],
      }),
    ).toBe(false);
  });
});

type AnalysisMetrics =
  ExperimentSnapshotAnalysis["results"][number]["variations"][number]["metrics"];

function makeAnalysis(metrics: AnalysisMetrics): ExperimentSnapshotAnalysis {
  return {
    analysisKey: "analysis_1",
    dateCreated: new Date("2026-08-25T00:00:00Z"),
    status: "success",
    settings: {
      dimensions: [],
      statsEngine: "bayesian",
      differenceType: "relative",
      numGoalMetrics: 1,
      numGuardrailMetrics: 0,
    },
    results: [{ name: "All", srm: 1, variations: [{ users: 0, metrics }] }],
  };
}

describe("findAnalysisComputeFailure", () => {
  it("returns the first experiment metric that failed to compute", () => {
    const analysis = makeAnalysis({
      failed: {
        value: 0,
        cr: 0,
        users: 0,
        computeFailed: true,
        errorMessage: "analysis failed",
      },
    });

    expect(findAnalysisComputeFailure(analysis)).toEqual({
      metricId: "failed",
      errorMessage: "analysis failed",
    });
  });

  it("ignores benign metric error messages", () => {
    const analysis = makeAnalysis({
      healthy: {
        value: 1,
        cr: 0.1,
        users: 10,
        errorMessage: "no units",
      },
    });

    expect(findAnalysisComputeFailure(analysis)).toBeNull();
  });

  it("accepts a missing analysis", () => {
    expect(findAnalysisComputeFailure(null)).toBeNull();
  });
});
