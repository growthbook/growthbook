import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/validators";
import { updateExperimentAnalysisTimeSeries } from "back-end/src/services/experimentTimeSeries";

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: [],
    statsEngine: "bayesian",
    regressionAdjusted: false,
    sequentialTesting: false,
    baselineVariationIndex: 0,
    differenceType: "relative",
    pValueCorrection: null,
    numGoalMetrics: 1,
    ...overrides,
  };
}

function makeAnalysis({
  differenceType,
  value,
  settings = {},
}: {
  differenceType: "relative" | "absolute" | "scaled";
  value: number;
  settings?: Partial<ExperimentSnapshotAnalysisSettings>;
}): ExperimentSnapshotAnalysis {
  return {
    analysisKey: `analysis_${differenceType}_${value}`,
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    status: "success",
    settings: makeAnalysisSettings({
      differenceType,
      ...settings,
    }),
    results: [
      {
        name: "All",
        srm: 0.9,
        variations: [
          {
            users: 100,
            metrics: {
              met_1: {
                value: 10,
                cr: 0.1,
                users: 100,
                stats: { users: 100, mean: 0.1, stddev: 0.2 },
              },
            },
          },
          {
            users: 120,
            metrics: {
              met_1: {
                value,
                cr: 0.2,
                users: 120,
                ci: [value - 0.1, value + 0.1],
                pValue: 0.03,
                expected: value,
                stats: { users: 120, mean: 0.2, stddev: 0.3 },
              },
            },
          },
        ],
      },
    ],
  };
}

function makeSnapshot(): ExperimentSnapshotInterface {
  return {
    id: "snp_1",
    organization: "org_1",
    experiment: "exp_1",
    phase: 0,
    dimension: null,
    dateCreated: new Date("2025-01-02T00:00:00Z"),
    runStarted: null,
    status: "success",
    settings: {
      manual: false,
      dimensions: [],
      metricSettings: [],
      goalMetrics: ["met_1"],
      secondaryMetrics: [],
      guardrailMetrics: [],
      activationMetric: null,
      defaultMetricPriorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 1,
      },
      regressionAdjustmentEnabled: false,
      attributionModel: "firstExposure",
      experimentId: "exp_1",
      queryFilter: "",
      segment: "",
      skipPartialData: false,
      datasourceId: "ds_1",
      exposureQueryId: "eq_1",
      startDate: new Date("2025-01-01T00:00:00Z"),
      endDate: new Date("2025-01-02T00:00:00Z"),
      variations: [
        { id: "0", weight: 0.5 },
        { id: "1", weight: 0.5 },
      ],
    },
    type: "standard",
    queries: [],
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [],
  };
}

function makeExperiment(): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    phases: [
      {
        name: "Main",
        dateStarted: new Date("2025-01-01T00:00:00Z"),
        reason: "",
        coverage: 1,
        variationWeights: [0.5, 0.5],
      },
    ],
    variations: [
      { id: "0", name: "Control", key: "0" },
      { id: "1", name: "Variation", key: "1" },
    ],
  } as ExperimentInterface;
}

describe("updateExperimentAnalysisTimeSeries", () => {
  it("does not let covariate absolute analyses replace regular absolute results", async () => {
    const upsertMultipleSingleDataPoint = jest
      .fn()
      .mockResolvedValue(undefined);
    const context = {
      models: {
        metricTimeSeries: {
          upsertMultipleSingleDataPoint,
        },
      },
    };

    await updateExperimentAnalysisTimeSeries({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
      analyses: [
        makeAnalysis({ differenceType: "relative", value: 1.2 }),
        makeAnalysis({ differenceType: "absolute", value: 12 }),
        makeAnalysis({ differenceType: "scaled", value: 120 }),
        makeAnalysis({
          differenceType: "absolute",
          value: 999,
          settings: {
            statsEngine: "frequentist",
            sequentialTesting: false,
            useCovariateAsResponse: true,
          },
        }),
      ],
      allMetricIds: ["met_1"],
      factMetrics: undefined,
      factTableMap: new Map(),
    });

    expect(upsertMultipleSingleDataPoint).toHaveBeenCalledTimes(1);
    const [dataPoints] = upsertMultipleSingleDataPoint.mock.calls[0];
    expect(dataPoints[0].singleDataPoint.variations[1].absolute?.value).toBe(
      12,
    );
  });
});
