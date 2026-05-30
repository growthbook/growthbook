import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/validators";
import { runEagerExperimentAndUnitDimensionsAnalyses } from "back-end/src/services/experimentDimensionAnalyses";
import { getOrCreatePrecomputedDimensionTimeSeriesAnalyses } from "back-end/src/services/experimentDimensionTimeSeries";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { logger } from "back-end/src/util/logger";

jest.mock("shared/experiments", () => ({
  ...jest.requireActual<typeof import("shared/experiments")>(
    "shared/experiments",
  ),
  getAllExpandedMetricIdsFromExperiment: jest.fn(() => ["met_1"]),
  isFactMetricId: jest.fn(() => false),
  expandAllSliceMetricsInMap: jest.fn(),
  getLatestPhaseVariations: jest.fn(() => [
    { id: "0", name: "Control" },
    { id: "1", name: "Variation" },
  ]),
}));

jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn(),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTableMap: jest.fn(),
}));

jest.mock("back-end/src/services/experimentDimensionTimeSeries", () => ({
  ...jest.requireActual("back-end/src/services/experimentDimensionTimeSeries"),
  getOrCreatePrecomputedDimensionTimeSeriesAnalyses: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

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
    numGuardrailMetrics: 0,
    ...overrides,
  };
}

function makeAnalysis({
  differenceType,
  dimensionValue = "US",
  dimensionId = "precomputed:country",
}: {
  differenceType: "relative" | "absolute" | "scaled";
  dimensionValue?: string;
  dimensionId?: string;
}): ExperimentSnapshotAnalysis {
  return {
    analysisKey: `analysis_${differenceType}`,
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    status: "success",
    settings: makeAnalysisSettings({
      differenceType,
      dimensions: dimensionId ? [dimensionId] : [],
    }),
    results: [
      {
        name: dimensionValue,
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
                value:
                  differenceType === "relative"
                    ? 1.2
                    : differenceType === "absolute"
                      ? 12
                      : 120,
                cr: 0.1,
                users: 120,
                ci: [0.1, 0.2],
                pValue: 0.03,
                expected: 0.15,
                stats: { users: 120, mean: 0.1, stddev: 0.3 },
              },
            },
          },
        ],
      },
    ],
  };
}

function makeSnapshot(
  overrides: Partial<ExperimentSnapshotInterface> = {},
): ExperimentSnapshotInterface {
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
      dimensions: [{ id: "precomputed:country" }],
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
    analyses: [
      {
        ...makeAnalysis({ differenceType: "relative", dimensionValue: "" }),
        settings: makeAnalysisSettings({ differenceType: "relative" }),
        results: [{ name: "", srm: 0.9, variations: [] }],
      },
    ],
    ...overrides,
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

function makeContext() {
  return {
    models: {
      metricGroups: {
        getAll: jest.fn().mockResolvedValue([]),
      },
      metricTimeSeries: {
        upsertMultipleSingleDataPoint: jest.fn().mockResolvedValue(undefined),
      },
      factMetrics: {
        getByIds: jest.fn().mockResolvedValue([]),
      },
    },
  };
}

describe("runEagerExperimentAndUnitDimensionsAnalyses", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMetricMap as jest.Mock).mockResolvedValue(new Map());
    (getFactTableMap as jest.Mock).mockResolvedValue(new Map());
    (
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses as jest.Mock
    ).mockResolvedValue([
      makeAnalysis({ differenceType: "relative" }),
      makeAnalysis({ differenceType: "absolute" }),
      makeAnalysis({ differenceType: "scaled" }),
    ]);
  });

  it("skips snapshots without precomputed dimensions", async () => {
    const context = makeContext();
    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot({
        settings: {
          ...makeSnapshot().settings,
          dimensions: [{ id: "country" }],
        },
      }),
    });

    expect(
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
    ).not.toHaveBeenCalled();
    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).not.toHaveBeenCalled();
  });

  it("skips dimensioned snapshots", async () => {
    const context = makeContext();
    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot({
        dimension: "precomputed:country",
      }),
    });

    expect(
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
    ).not.toHaveBeenCalled();
    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).not.toHaveBeenCalled();
  });

  it("skips snapshots without a time-series-compatible base analysis", async () => {
    const context = makeContext();
    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot({
        analyses: [
          {
            ...makeAnalysis({ differenceType: "relative" }),
            settings: makeAnalysisSettings({
              baselineVariationIndex: 1,
            }),
          },
        ],
      }),
    });

    expect(getMetricMap).not.toHaveBeenCalled();
    expect(
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
    ).not.toHaveBeenCalled();
    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).not.toHaveBeenCalled();
  });

  it("gets or creates relative, absolute, and scaled analyses and writes dimension time series", async () => {
    const context = makeContext();
    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
    });

    expect(
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
    ).toHaveBeenCalledTimes(1);
    expect(
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
    ).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        dimensionId: "precomputed:country",
      }),
    );

    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        source: "experiment",
        sourceId: "exp_1",
        sourcePhase: 0,
        metricId: "met_1",
        dimensionId: "precomputed:country",
        dimensionValue: "US",
        singleDataPoint: expect.objectContaining({
          date: new Date("2025-01-02T00:00:00Z"),
          variations: [
            expect.objectContaining({
              id: "0",
              name: "Control",
            }),
            expect.objectContaining({
              id: "1",
              name: "Variation",
              relative: expect.objectContaining({ value: 1.2 }),
              absolute: expect.objectContaining({ value: 12 }),
              scaled: expect.objectContaining({ value: 120 }),
            }),
          ],
        }),
      }),
    ]);
  });

  it("writes time series for empty string dimension values", async () => {
    const context = makeContext();
    (
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses as jest.Mock
    ).mockResolvedValue([
      makeAnalysis({ differenceType: "relative", dimensionValue: "" }),
      makeAnalysis({ differenceType: "absolute", dimensionValue: "" }),
      makeAnalysis({ differenceType: "scaled", dimensionValue: "" }),
    ]);

    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
    });

    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        dimensionId: "precomputed:country",
        dimensionValue: "",
      }),
    ]);
  });

  it("gets or creates unit-dimension analyses on the parent snapshot and writes time series", async () => {
    const context = makeContext();
    (
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses as jest.Mock
    ).mockResolvedValue([
      makeAnalysis({ differenceType: "relative", dimensionId: "dim_country" }),
      makeAnalysis({ differenceType: "absolute", dimensionId: "dim_country" }),
      makeAnalysis({ differenceType: "scaled", dimensionId: "dim_country" }),
    ]);

    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot({
        settings: {
          ...makeSnapshot().settings,
          dimensions: [],
          precomputedUnitDimensionIds: ["dim_country"],
        },
      }),
    });

    expect(
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
    ).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        dimensionId: "dim_country",
        snapshot: expect.objectContaining({ id: "snp_1" }),
      }),
    );
    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        source: "experiment",
        sourceId: "exp_1",
        sourcePhase: 0,
        metricId: "met_1",
        dimensionId: "dim_country",
        dimensionValue: "US",
      }),
    ]);
  });

  it("does not run unit-dimension analyses for bandit experiments", async () => {
    const context = makeContext();
    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: {
        ...makeExperiment(),
        type: "multi-armed-bandit",
      } as ExperimentInterface,
      experimentSnapshot: makeSnapshot({
        settings: {
          ...makeSnapshot().settings,
          dimensions: [],
          precomputedUnitDimensionIds: ["dim_country"],
        },
      }),
    });

    expect(
      getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
    ).not.toHaveBeenCalled();
    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).not.toHaveBeenCalled();
  });

  it("logs per-dimension failures and continues with later dimensions", async () => {
    const context = makeContext();
    (getOrCreatePrecomputedDimensionTimeSeriesAnalyses as jest.Mock)
      .mockRejectedValueOnce(new Error("first dimension failed"))
      .mockResolvedValueOnce([
        makeAnalysis({
          differenceType: "relative",
          dimensionValue: "Chrome",
          dimensionId: "precomputed:browser",
        }),
        makeAnalysis({
          differenceType: "absolute",
          dimensionValue: "Chrome",
          dimensionId: "precomputed:browser",
        }),
        makeAnalysis({
          differenceType: "scaled",
          dimensionValue: "Chrome",
          dimensionId: "precomputed:browser",
        }),
      ]);

    await runEagerExperimentAndUnitDimensionsAnalyses({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot({
        settings: {
          ...makeSnapshot().settings,
          dimensions: [
            { id: "precomputed:country" },
            { id: "precomputed:browser" },
          ],
        },
      }),
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ dimensionId: "precomputed:country" }),
      "Eager precomputed dimension analysis failed",
    );
    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        dimensionId: "precomputed:browser",
        dimensionValue: "Chrome",
      }),
    ]);
  });
});
