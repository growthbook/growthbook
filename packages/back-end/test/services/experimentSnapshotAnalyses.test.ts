import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import {
  addOrUpdateSnapshotAnalysis,
  addOrUpdateSnapshotMultipleAnalysis,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getQueryMap } from "back-end/src/queryRunners/QueryRunner";
import {
  buildExperimentBulkResultId,
  createSnapshotAnalysesBatched,
  createSnapshotAnalysis,
  safeFloatOrNull,
  toApiResultAnalysis,
  toExperimentSnapshotBulkResultsApiInterface,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";

jest.mock("back-end/src/services/stats", () => ({
  analyzeExperimentResults: jest.fn(),
  getMetricsAndQueryDataForStatsEngine: jest.fn(),
  runSnapshotAnalyses: jest.fn(),
  writeSnapshotAnalyses: jest.fn(),
}));

jest.mock("back-end/src/queryRunners/QueryRunner", () => ({
  QueryRunner: class {},
  getQueryMap: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  addOrUpdateSnapshotAnalysis: jest.fn(),
  addOrUpdateSnapshotMultipleAnalysis: jest.fn(),
  createExperimentSnapshotModel: jest.fn(),
  getLatestSnapshotMultipleExperiments: jest.fn(),
  updateSnapshot: jest.fn(),
  updateSnapshotAnalysis: jest.fn(),
}));

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: ["precomputed:country"],
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
    queries: [{ status: "success" } as never],
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [],
  };
}

function makeExperiment(): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    trackingKey: "experiment-key",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
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

describe("safeFloatOrNull", () => {
  it("preserves finite values, including zero", () => {
    expect(safeFloatOrNull(0)).toBe(0);
    expect(safeFloatOrNull(1.25)).toBe(1.25);
  });

  it("returns null for missing and non-finite values", () => {
    expect(safeFloatOrNull(undefined)).toBeNull();
    expect(safeFloatOrNull(Infinity)).toBeNull();
    expect(safeFloatOrNull(-Infinity)).toBeNull();
    expect(safeFloatOrNull(NaN)).toBeNull();
  });
});

describe("buildExperimentBulkResultId", () => {
  it("builds stable ids for overall and dimension result items", () => {
    expect(buildExperimentBulkResultId("snp_1", "")).toBe("snp_1:overall");
    expect(buildExperimentBulkResultId("snp_1", "precomputed:country")).toBe(
      "snp_1:dimension:precomputed%3Acountry",
    );
  });
});

describe("toApiResultAnalysis", () => {
  const data: SnapshotMetric = {
    value: 10,
    cr: 1,
    users: 10,
    expected: 0.25,
  };

  it("returns effect and deprecated percentChange for relative analyses", () => {
    expect(toApiResultAnalysis("bayesian", "relative", data)).toEqual(
      expect.objectContaining({
        effect: 0.25,
        percentChange: 0.25,
      }),
    );
  });

  it("returns effect without percentChange for non-relative analyses", () => {
    const result = toApiResultAnalysis("bayesian", "absolute", data);

    expect(result.effect).toBe(0.25);
    expect(result).not.toHaveProperty("percentChange");
  });
});

describe("toSnapshotApiInterface", () => {
  it("returns the snapshot metadata required by ExperimentResults", () => {
    const snapshot = makeSnapshot();

    expect(
      toSnapshotApiInterface(makeExperiment(), snapshot, new Map()),
    ).toEqual(
      expect.objectContaining({
        snapshotId: snapshot.id,
        dateCreated: snapshot.dateCreated.toISOString(),
        type: "standard",
        dimension: {
          type: "none",
          precomputed: false,
        },
      }),
    );
  });
});

describe("toExperimentSnapshotBulkResultsApiInterface", () => {
  it("uses a unique dimension result id while preserving snapshotId", () => {
    const snapshot = makeSnapshot();
    snapshot.analyses = [
      {
        analysisKey: "analysis_1",
        settings: makeAnalysisSettings(),
        dateCreated: snapshot.dateCreated,
        status: "success",
        results: [],
      },
    ];

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    expect(result.id).toBe("snp_1:dimension:precomputed%3Acountry");
    expect(result.snapshotId).toBe(snapshot.id);
  });
});

describe("createSnapshotAnalysesBatched", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getQueryMap as jest.Mock).mockResolvedValue(new Map());
  });

  it("writes errored final analyses when the stats engine fails", async () => {
    const analysisSettingsList = [
      makeAnalysisSettings({ differenceType: "relative" }),
      makeAnalysisSettings({ differenceType: "absolute" }),
    ];
    (analyzeExperimentResults as jest.Mock).mockRejectedValue(
      new Error("stats failed"),
    );

    const analyses = await createSnapshotAnalysesBatched(
      { org: { id: "org_1" } } as never,
      {
        experiment: makeExperiment(),
        snapshot: makeSnapshot(),
        metricMap: new Map(),
        analysisSettingsList,
      },
    );

    expect(addOrUpdateSnapshotAnalysis).not.toHaveBeenCalled();
    expect(addOrUpdateSnapshotMultipleAnalysis).toHaveBeenCalledWith({
      context: { org: { id: "org_1" } },
      id: "snp_1",
      analyses: [
        expect.objectContaining({
          settings: analysisSettingsList[0],
          results: [],
          status: "error",
          error: "stats failed",
        }),
        expect.objectContaining({
          settings: analysisSettingsList[1],
          results: [],
          status: "error",
          error: "stats failed",
        }),
      ],
    });
    expect(analyses).toEqual([
      expect.objectContaining({
        settings: analysisSettingsList[0],
        status: "error",
        error: "stats failed",
      }),
      expect.objectContaining({
        settings: analysisSettingsList[1],
        status: "error",
        error: "stats failed",
      }),
    ]);
  });

  it("rewrites parent unit-dimension queries to bare metric keys", async () => {
    const parentQuery = { id: "qry_parent" };
    const unitQuery = { id: "qry_unit_country" };
    (getQueryMap as jest.Mock).mockResolvedValue(
      new Map([
        ["met_1", parentQuery],
        ["unitdim:dim_country:met_1", unitQuery],
      ]),
    );
    (analyzeExperimentResults as jest.Mock).mockResolvedValue({
      results: [{ dimensions: [{ name: "US", variations: [] }] }],
    });

    const analysisSettingsList = [
      makeAnalysisSettings({
        differenceType: "relative",
        dimensions: ["dim_country"],
      }),
    ];
    const analyses = await createSnapshotAnalysesBatched(
      { org: { id: "org_1" } } as never,
      {
        experiment: makeExperiment(),
        snapshot: {
          ...makeSnapshot(),
          settings: {
            ...makeSnapshot().settings,
            precomputedUnitDimensionIds: ["dim_country"],
          },
        },
        metricMap: new Map(),
        analysisSettingsList,
      },
    );

    const queryData = (analyzeExperimentResults as jest.Mock).mock.calls[0][0]
      .queryData as Map<string, unknown>;
    expect(Array.from(queryData.keys())).toEqual(["met_1"]);
    expect(queryData.get("met_1")).toBe(unitQuery);
    expect(analyses[0]).toEqual(
      expect.objectContaining({
        settings: analysisSettingsList[0],
        status: "success",
        results: [{ name: "US", variations: [] }],
      }),
    );
  });
});

describe("createSnapshotAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rewrites parent unit-dimension queries to bare metric keys for lazy analyses", async () => {
    const parentQuery = { id: "qry_parent" };
    const unitQuery = { id: "qry_unit_country" };
    (getQueryMap as jest.Mock).mockResolvedValue(
      new Map([
        ["met_1", parentQuery],
        ["unitdim:dim_country:met_1", unitQuery],
      ]),
    );
    (analyzeExperimentResults as jest.Mock).mockResolvedValue({
      results: [{ dimensions: [] }],
    });

    await createSnapshotAnalysis({ org: { id: "org_1" } } as never, {
      experiment: makeExperiment(),
      snapshot: {
        ...makeSnapshot(),
        settings: {
          ...makeSnapshot().settings,
          precomputedUnitDimensionIds: ["dim_country"],
        },
      },
      metricMap: new Map(),
      analysisSettings: makeAnalysisSettings({
        dimensions: ["dim_country"],
      }),
    });

    const queryData = (analyzeExperimentResults as jest.Mock).mock.calls[0][0]
      .queryData as Map<string, unknown>;
    expect(Array.from(queryData.keys())).toEqual(["met_1"]);
    expect(queryData.get("met_1")).toBe(unitQuery);
  });
});
