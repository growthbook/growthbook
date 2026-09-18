import {
  analysisStatusFromResults,
  findAnalysisComputeFailure,
  isAnalysisAllowed,
  snapshotStatusFromAnalyses,
} from "../../src/util";
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

function makeAnalysis(
  metrics: AnalysisMetrics,
  status: ExperimentSnapshotAnalysis["status"] = "success",
  otherVariationMetrics: AnalysisMetrics[] = [],
): ExperimentSnapshotAnalysis {
  return {
    analysisKey: "analysis_1",
    dateCreated: new Date("2026-08-25T00:00:00Z"),
    status,
    settings: {
      dimensions: [],
      statsEngine: "bayesian",
      differenceType: "relative",
      numGoalMetrics: 1,
      numGuardrailMetrics: 0,
    },
    results: [
      {
        name: "All",
        srm: 1,
        variations: [metrics, ...otherVariationMetrics].map((metrics) => ({
          users: 0,
          metrics,
        })),
      },
    ],
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

describe("analysisStatusFromResults", () => {
  it("is partial when a metric failed to compute", () => {
    const analysis = makeAnalysis({
      failed: {
        value: 0,
        cr: 0,
        users: 0,
        computeFailed: true,
        errorMessage: "analysis failed",
      },
      healthy: { value: 1, cr: 0.1, users: 10 },
    });

    expect(analysisStatusFromResults(analysis.results)).toBe("partial");
  });

  it("is partial when only a later variation carries the failure", () => {
    const analysis = makeAnalysis(
      { failed: { value: 1, cr: 0.1, users: 10 } },
      "success",
      [{ failed: { value: 0, cr: 0, users: 0, computeFailed: true } }],
    );

    expect(analysisStatusFromResults(analysis.results)).toBe("partial");
  });

  it("is success when a metric has a message but did not fail", () => {
    const analysis = makeAnalysis({
      healthy: { value: 1, cr: 0.1, users: 10, errorMessage: "no units" },
    });

    expect(analysisStatusFromResults(analysis.results)).toBe("success");
  });

  it("is success for empty results", () => {
    expect(analysisStatusFromResults([])).toBe("success");
  });
});

describe("snapshotStatusFromAnalyses", () => {
  it("returns partial-success when any analysis is partial", () => {
    expect(
      snapshotStatusFromAnalyses([
        { status: "success" },
        { status: "partial" },
      ]),
    ).toBe("partial-success");
  });

  it("returns success when all analyses succeeded", () => {
    expect(
      snapshotStatusFromAnalyses([
        { status: "success" },
        { status: "success" },
      ]),
    ).toBe("success");
  });

  it("returns partial-success when a whole analysis errored", () => {
    expect(
      snapshotStatusFromAnalyses([{ status: "success" }, { status: "error" }]),
    ).toBe("partial-success");
  });
});
