import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";
import { tabulateCovariateImbalance } from "../src/health/covariate-imbalance";

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: [],
    statsEngine: "frequentist",
    regressionAdjusted: false,
    sequentialTesting: false,
    baselineVariationIndex: 0,
    differenceType: "relative",
    pValueCorrection: null,
    numGoalMetrics: 1,
    numGuardrailMetrics: 0,
    useCovariateAsResponse: true,
    ...overrides,
  };
}

describe("tabulateCovariateImbalance", () => {
  it("does not tabulate slice metrics when metricSettings lists them", () => {
    const sliceId = "m_goal?dim:country=us";
    const mk = (pValue: number) => ({
      value: 0.1,
      cr: 0.1,
      users: 500,
      pValue,
      stats: { users: 500, count: 500, stddev: 1, mean: 0.1 },
    });
    const overall: ExperimentReportResultDimension = {
      name: "",
      srm: 1,
      variations: [
        { users: 500, metrics: { m_goal: mk(0.5), [sliceId]: mk(0.5) } },
        { users: 500, metrics: { m_goal: mk(0.01), [sliceId]: mk(0.02) } },
      ],
    };
    const analysis: ExperimentSnapshotAnalysis = {
      settings: makeAnalysisSettings(),
      dateCreated: new Date(),
      status: "success",
      results: [overall],
    };

    const withSliceInSettings = tabulateCovariateImbalance(
      analysis,
      ["m_goal"],
      [],
      [],
      [{ id: "m_goal" }, { id: sliceId }],
    );

    expect(
      withSliceInSettings.metricVariationCovariateImbalanceResults.map(
        (r) => r.metricId,
      ),
    ).toEqual(["m_goal"]);
  });
});
