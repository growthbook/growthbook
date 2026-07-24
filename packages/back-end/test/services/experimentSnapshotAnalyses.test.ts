import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  MetricForSnapshot,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentMetricInterface } from "shared/experiments";
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

function makeSuccessAnalysis(
  settings: ExperimentSnapshotAnalysisSettings,
  results: ExperimentSnapshotAnalysis["results"] = [],
): ExperimentSnapshotAnalysis {
  return {
    analysisKey: `${settings.dimensions.join(",")}:${settings.differenceType}`,
    settings,
    dateCreated: new Date("2025-01-02T00:00:00Z"),
    status: "success",
    results,
  };
}

function makeSnapshotMetricData(
  overrides: Partial<SnapshotMetric> = {},
): SnapshotMetric {
  return { value: 10, cr: 0.5, users: 20, expected: 0.1, ...overrides };
}

// One result slice ("All") with the given per-variation metric data.
function makeOverallResult(
  metricId: string,
  perVariation: (SnapshotMetric | undefined)[],
): ExperimentSnapshotAnalysis["results"] {
  return [
    {
      name: "All",
      srm: 1,
      variations: perVariation.map((data) => ({
        users: data?.users ?? 0,
        metrics: data ? { [metricId]: data } : {},
      })),
    },
  ];
}

function makeMetricMap(
  entries: Record<string, string>,
): Map<string, ExperimentMetricInterface> {
  return new Map(
    Object.entries(entries).map(
      ([id, name]) => [id, { id, name } as ExperimentMetricInterface] as const,
    ),
  );
}

function makeComputedSettings(): NonNullable<
  MetricForSnapshot["computedSettings"]
> {
  return {
    windowSettings: {
      type: "conversion",
      delayValue: 2,
      delayUnit: "hours",
      windowValue: 72,
      windowUnit: "hours",
    },
    properPrior: true,
    properPriorMean: 0,
    properPriorStdDev: 0.3,
    regressionAdjustmentEnabled: true,
    regressionAdjustmentAvailable: true,
    regressionAdjustmentDays: 14,
    regressionAdjustmentReason: "",
    targetMDE: 0.05,
  };
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

  it("maps stats to effect and omits percentChange and risk", () => {
    const result = toApiResultAnalysis("bayesian", "relative", data);

    expect(result.effect).toBe(0.25);
    expect(result).not.toHaveProperty("percentChange");
    expect(result).not.toHaveProperty("risk");
  });

  it("returns null for missing and non-finite statistics", () => {
    const result = toApiResultAnalysis("frequentist", "absolute", {
      value: 5,
      cr: 0.5,
      users: 10,
      pValue: Infinity,
    });

    expect(result.effect).toBeNull();
    expect(result.pValue).toBeNull();
    expect(result.mean).toBeNull();
  });
});

describe("toSnapshotApiInterface (legacy contract)", () => {
  it("keeps the legacy shape: no bulk-only fields, current-experiment settings", () => {
    const snapshot = makeSnapshot();
    snapshot.analyses = [
      makeSuccessAnalysis(
        makeAnalysisSettings({ dimensions: [""] }),
        makeOverallResult("met_1", [
          makeSnapshotMetricData(),
          makeSnapshotMetricData(),
        ]),
      ),
    ];

    const result = toSnapshotApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    // Legacy dimension descriptor has no `precomputed` flag.
    expect(result.dimension).toEqual({ type: "none" });
    // Bulk-only metadata must not appear on the legacy payload.
    expect(result).not.toHaveProperty("snapshotId");
    expect(result).not.toHaveProperty("dateCreated");
    expect(result).not.toHaveProperty("type");
    // Settings still come from the current experiment (tracking key).
    expect(result.settings.experimentId).toBe("experiment-key");
    // Variation id is the current internal id.
    expect(result.results[0].metrics[0].variations[0].variationId).toBe("0");
  });

  it("emits 0 (not null) for missing statistics to preserve its contract", () => {
    const snapshot = makeSnapshot();
    snapshot.analyses = [
      makeSuccessAnalysis(
        makeAnalysisSettings({ dimensions: [""] }),
        makeOverallResult("met_1", [
          { value: 5, cr: 0.5, users: 10 } as SnapshotMetric,
        ]),
      ),
    ];

    const result = toSnapshotApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );
    const analysis = result.results[0].metrics[0].variations[0].analyses[0];

    expect(analysis.percentChange).toBe(0);
    expect(analysis.pValue).toBe(0);
  });
});

describe("toExperimentSnapshotBulkResultsApiInterface", () => {
  it("uses a unique dimension result id while preserving snapshotId", () => {
    const snapshot = makeSnapshot();
    snapshot.analyses = [makeSuccessAnalysis(makeAnalysisSettings())];

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    expect(result.id).toBe("snp_1:dimension:precomputed%3Acountry");
    expect(result.snapshotId).toBe(snapshot.id);
  });

  it("sources settings, dates, and metric lists from the snapshot, not the experiment", () => {
    const snapshot = makeSnapshot();
    snapshot.settings.metricSettings = [
      { id: "met_1", computedSettings: makeComputedSettings() },
    ];
    snapshot.analyses = [
      makeSuccessAnalysis(
        makeAnalysisSettings({ dimensions: [""], regressionAdjusted: true }),
        makeOverallResult("met_1", [
          makeSnapshotMetricData(),
          makeSnapshotMetricData(),
        ]),
      ),
    ];

    // Drift the current experiment away from the snapshot.
    const experiment = makeExperiment();
    experiment.trackingKey = "renamed-key";
    experiment.datasource = "ds_current";
    experiment.goalMetrics = ["met_current"];
    experiment.phases[0].dateStarted = new Date("2024-06-01T00:00:00Z");

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      experiment,
      snapshot,
      makeMetricMap({ met_1: "Revenue" }),
    );

    expect(result.settings.experimentId).toBe("exp_1");
    expect(result.settings.datasourceId).toBe("ds_1");
    expect(result.settings.assignmentQueryId).toBe("eq_1");
    // Metric list comes from snapshot.settings.goalMetrics.
    expect(result.settings.goals.map((g) => g.metricId)).toEqual(["met_1"]);
    // Analysis window is the snapshot window, not the current phase.
    expect(result.dateStart).toBe(snapshot.settings.startDate.toISOString());
    // Per-analysis flag comes from the stored analysis.
    expect(result.settings.regressionAdjustmentEnabled).toBe(true);
    // Best-effort current display name resolved by id.
    expect(result.results[0].metrics[0].metricName).toBe("Revenue");
  });

  it("exposes snapshot effective metric settings when stored", () => {
    const snapshot = makeSnapshot();
    snapshot.settings.metricSettings = [
      { id: "met_1", computedSettings: makeComputedSettings() },
    ];
    snapshot.analyses = [
      makeSuccessAnalysis(makeAnalysisSettings({ dimensions: [""] })),
    ];

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    expect(result.settings.goals[0].effectiveSettings).toEqual({
      windowType: "conversion",
      windowValue: 72,
      windowUnit: "hours",
      delayValue: 2,
      delayUnit: "hours",
      properPrior: true,
      properPriorMean: 0,
      properPriorStdDev: 0.3,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 14,
      targetMDE: 0.05,
    });
  });

  it("omits effectiveSettings for legacy snapshots without computed settings", () => {
    const snapshot = makeSnapshot();
    snapshot.settings.metricSettings = [];
    snapshot.analyses = [
      makeSuccessAnalysis(makeAnalysisSettings({ dimensions: [""] })),
    ];

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    expect(result.settings.goals[0]).toEqual({ metricId: "met_1" });
  });

  it("resolves variation id/name by snapshot key, keeping index authoritative", () => {
    const snapshot = makeSnapshot();
    // Snapshot stored warehouse keys that differ from internal ids.
    snapshot.settings.variations = [
      { id: "control", weight: 0.5 },
      { id: "treatment", weight: 0.5 },
    ];
    snapshot.analyses = [
      makeSuccessAnalysis(
        makeAnalysisSettings({ dimensions: [""] }),
        makeOverallResult("met_1", [
          makeSnapshotMetricData(),
          makeSnapshotMetricData(),
        ]),
      ),
    ];

    const experiment = makeExperiment();
    experiment.variations = [
      { id: "var_abc", name: "Control", key: "control" },
      { id: "var_def", name: "Treatment", key: "treatment" },
    ] as ExperimentInterface["variations"];

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      experiment,
      snapshot,
      new Map(),
    );

    const variations = result.results[0].metrics[0].variations;
    expect(variations[0]).toEqual(
      expect.objectContaining({
        variationIndex: 0,
        variationKey: "control",
        variationId: "var_abc",
        variationName: "Control",
      }),
    );
    expect(variations[1]).toEqual(
      expect.objectContaining({
        variationIndex: 1,
        variationKey: "treatment",
        variationId: "var_def",
      }),
    );
  });

  it("omits variationId/name when the snapshot key no longer matches a variation", () => {
    const snapshot = makeSnapshot();
    snapshot.settings.variations = [
      { id: "gone", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ];
    snapshot.analyses = [
      makeSuccessAnalysis(
        makeAnalysisSettings({ dimensions: [""] }),
        makeOverallResult("met_1", [
          makeSnapshotMetricData(),
          makeSnapshotMetricData(),
        ]),
      ),
    ];

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    const [removed, kept] = result.results[0].metrics[0].variations;
    expect(removed.variationKey).toBe("gone");
    expect(removed).not.toHaveProperty("variationId");
    expect(removed).not.toHaveProperty("variationName");
    expect(kept.variationId).toBe("1");
  });

  it("expands multiple dimensions into unique items and folds difference types", () => {
    const snapshot = makeSnapshot();
    const relativeOverall = makeAnalysisSettings({ dimensions: [""] });
    const absoluteOverall = makeAnalysisSettings({
      dimensions: [""],
      differenceType: "absolute",
    });
    const relativeDim = makeAnalysisSettings({
      dimensions: ["precomputed:country"],
    });
    snapshot.settings.precomputedUnitDimensionIds = [];
    snapshot.analyses = [
      makeSuccessAnalysis(
        relativeOverall,
        makeOverallResult("met_1", [makeSnapshotMetricData()]),
      ),
      makeSuccessAnalysis(
        absoluteOverall,
        makeOverallResult("met_1", [makeSnapshotMetricData()]),
      ),
      makeSuccessAnalysis(
        relativeDim,
        makeOverallResult("met_1", [makeSnapshotMetricData()]),
      ),
    ];

    const results = toExperimentSnapshotBulkResultsApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    // One item per dimension, each with a unique id.
    expect(results.map((r) => r.id)).toEqual([
      "snp_1:overall",
      "snp_1:dimension:precomputed%3Acountry",
    ]);
    // The overall item folds relative + absolute into the analyses array.
    const overallAnalyses =
      results[0].results[0].metrics[0].variations[0].analyses;
    expect(overallAnalyses.map((a) => a.differenceType)).toEqual([
      "relative",
      "absolute",
    ]);
  });

  it("falls back to phase dates for legacy snapshots without settings dates", () => {
    const snapshot = makeSnapshot();
    // Simulate a legacy snapshot missing stored window dates.
    (snapshot.settings as { startDate?: Date }).startDate = undefined;
    (snapshot.settings as { endDate?: Date }).endDate = undefined;
    snapshot.analyses = [
      makeSuccessAnalysis(makeAnalysisSettings({ dimensions: [""] })),
    ];

    const [result] = toExperimentSnapshotBulkResultsApiInterface(
      makeExperiment(),
      snapshot,
      new Map(),
    );

    expect(result.dateStart).toBe(
      new Date("2025-01-01T00:00:00Z").toISOString(),
    );
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
