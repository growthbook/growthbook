import {
  ExperimentMetricInterface,
  getMetricSnapshotSettings,
} from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import { DataSourceInterface } from "shared/types/datasource";
import {
  ExperimentSnapshotAnalysisSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import { MetricSnapshotSettings } from "shared/types/report";
import { ApiReqContext } from "back-end/types/api";
import {
  assertIncrementalRefreshPrerequisites,
  exploratoryOverallRequiresFullRefresh,
} from "back-end/src/enterprise/services/data-pipeline";
import { ExperimentIncrementalPipelineRequiresFullRefreshError } from "back-end/src/util/errors";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  getSnapshotSettings,
  planSnapshot,
} from "back-end/src/services/experiments";
import { planMetricFanOut } from "back-end/src/services/experimentQueries/planMetricFanOut";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import {
  createExperimentSnapshotModel,
  findSnapshotById,
  getLatestSuccessfulSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  createExperimentSnapshotModel: jest.fn(),
  findSnapshotById: jest.fn(),
  getLatestSuccessfulSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock("back-end/src/enterprise/services/dashboards", () => ({
  updateExperimentDashboards: jest.fn(),
}));

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

jest.mock("back-end/src/enterprise/services/data-pipeline", () => ({
  assertIncrementalRefreshPrerequisites: jest.fn(),
  exploratoryOverallRequiresFullRefresh: jest.fn(),
}));

const {
  getExperimentSettingsHashForIncrementalRefresh,
  getFactTablesNeedingRebuild,
  getMetricSettingsHashForIncrementalRefresh,
} = jest.requireActual<
  typeof import("back-end/src/enterprise/services/data-pipeline")
>(
  "back-end/src/enterprise/services/data-pipeline",
) as typeof import("back-end/src/enterprise/services/data-pipeline");

const updateExperimentMock = updateExperiment as jest.MockedFunction<
  typeof updateExperiment
>;
const createExperimentSnapshotModelMock =
  createExperimentSnapshotModel as jest.MockedFunction<
    typeof createExperimentSnapshotModel
  >;
const findSnapshotByIdMock = findSnapshotById as jest.MockedFunction<
  typeof findSnapshotById
>;
const getLatestSuccessfulSnapshotMock =
  getLatestSuccessfulSnapshot as jest.MockedFunction<
    typeof getLatestSuccessfulSnapshot
  >;
const getDataSourceByIdMock = getDataSourceById as jest.MockedFunction<
  typeof getDataSourceById
>;
const getSourceIntegrationObjectMock =
  getSourceIntegrationObject as jest.MockedFunction<
    typeof getSourceIntegrationObject
  >;
const updateExperimentDashboardsMock =
  updateExperimentDashboards as jest.MockedFunction<
    typeof updateExperimentDashboards
  >;
const assertIncrementalRefreshPrerequisitesMock =
  assertIncrementalRefreshPrerequisites as jest.MockedFunction<
    typeof assertIncrementalRefreshPrerequisites
  >;
const exploratoryOverallRequiresFullRefreshMock =
  exploratoryOverallRequiresFullRefresh as jest.MockedFunction<
    typeof exploratoryOverallRequiresFullRefresh
  >;
const orgHasPremiumFeatureMock = orgHasPremiumFeature as jest.MockedFunction<
  typeof orgHasPremiumFeature
>;

function makeIncrementalDatasource(): DataSourceInterface {
  return makeDatasource({
    settings: {
      queries: {},
      pipelineSettings: {
        allowWriting: true,
        mode: "incremental",
      },
    },
  });
}

function wireIncrementalIntegration(datasource: DataSourceInterface): void {
  getDataSourceByIdMock.mockResolvedValue(datasource);
  getSourceIntegrationObjectMock.mockReturnValue({
    datasource,
    getSourceProperties: () => ({
      hasIncrementalRefresh: true,
      hasQuantileSketch: true,
    }),
  } as never);
}

function makeContext(): ApiReqContext {
  return {
    org: {
      id: "org_123",
      settings: {},
    },
    models: {
      metricGroups: {
        getAll: jest.fn().mockResolvedValue([]),
      },
    },
  } as unknown as ApiReqContext;
}

function makeDatasource(
  overrides: Partial<DataSourceInterface> = {},
): DataSourceInterface {
  return {
    id: "ds_123",
    type: "postgres",
    settings: {
      queries: {},
      ...overrides.settings,
    },
    ...overrides,
  } as unknown as DataSourceInterface;
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_123",
    organization: "org_123",
    datasource: "ds_123",
    project: "",
    owner: "",
    tags: [],
    type: "standard",
    variations: [{ name: "Control" }, { name: "Treatment" }],
    phases: [
      {
        dateStarted: new Date("2025-01-01T00:00:00.000Z"),
        variationWeights: [0.5, 0.5],
      },
    ],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    metricOverrides: {},
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: [],
    statsEngine: "bayesian",
    numGoalMetrics: 1,
    numGuardrailMetrics: 0,
    differenceType: "relative",
    ...overrides,
  } as ExperimentSnapshotAnalysisSettings;
}

describe("snapshot planning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDataSourceByIdMock.mockResolvedValue(makeDatasource());
    getSourceIntegrationObjectMock.mockReturnValue({} as never);
    exploratoryOverallRequiresFullRefreshMock.mockReturnValue(false);
  });

  it("plans a draft snapshot without persisting or mutating experiment state", async () => {
    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context: makeContext(),
      type: "standard",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: false,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.runnerKind).toBe("results");
    // useCache: false → full refresh, with a free-form reason explaining why.
    expect(plan.fullRefresh).toBe(true);
    expect(plan.fullRefreshReason).toBe("Full refresh explicitly requested.");
    expect(plan.snapshot.status).toBe("running");
    expect(plan.snapshot.triggeredBy).toBe("manual-dashboard");
    expect(plan.snapshot.analyses).toHaveLength(1);
    expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
    expect(updateExperimentMock).not.toHaveBeenCalled();
    expect(updateExperimentDashboardsMock).not.toHaveBeenCalled();
  });

  it("surfaces pipeline validation errors as incremental fallback reasons", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    assertIncrementalRefreshPrerequisitesMock.mockRejectedValue(
      new Error("metric not compatible"),
    );

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "standard",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalled();
    expect(plan.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe("metric not compatible");
  });

  it("preserves the computed full refresh when using the incremental runner on a first run", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const context = makeContext();
    // First run: no prior incremental state, so the warehouse units table
    // does not exist yet and a full refresh is required.
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue(null),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "standard",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.runnerKind).toBe("incremental");
    // The incremental runner must not discard the computed full refresh, or it
    // would attempt an incremental update against a non-existent units table.
    expect(plan.fullRefresh).toBe(true);
    expect(plan.fullRefreshReason).toBe(
      "No prior Incremental Pipeline state for this experiment.",
    );
    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-fullRefresh" }),
    );
  });

  it("keeps the incremental runner when only metric settings drift", async () => {
    orgHasPremiumFeatureMock.mockReturnValue(true);
    assertIncrementalRefreshPrerequisitesMock.mockImplementation(
      jest.requireActual<
        typeof import("back-end/src/enterprise/services/data-pipeline")
      >("back-end/src/enterprise/services/data-pipeline")
        .assertIncrementalRefreshPrerequisites,
    );

    const datasource = makeIncrementalDatasource();
    wireIncrementalIntegration(datasource);

    const factTable = factTableFactory.build({ id: "ft_a" });
    const factTableMap = new Map([[factTable.id, factTable]]) as FactTableMap;
    const metric = factMetricFactory.build({
      id: "m1",
      numerator: { factTableId: "ft_a", column: "amount" },
      windowSettings: {
        type: "conversion",
        windowValue: 14,
        windowUnit: "days",
        delayValue: 0,
        delayUnit: "hours",
      },
    });
    const metricMap = new Map<string, ExperimentMetricInterface>([
      [metric.id, metric],
    ]);
    const { metricSnapshotSettings } = getMetricSnapshotSettings({
      metric,
      denominatorMetrics: [],
      experimentRegressionAdjustmentEnabled: false,
    });
    const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [
      metricSnapshotSettings,
    ];
    const experiment = makeExperiment({
      goalMetrics: ["m1"],
      metricOverrides: [],
    });

    const persistedMetricSources = [
      {
        groupId: "grp_a",
        factTableId: "ft_a",
        tableFullName: "db.schema.cache_a",
        maxTimestamp: null,
        metrics: [{ id: "m1", settingsHash: "placeholder" }],
      },
    ];
    const incrementalRefreshModel = {
      unitsTableFullName: "db.schema.units_exp_123",
      metricSources: persistedMetricSources,
    };

    const snapshotSettings = getSnapshotSettings({
      experiment,
      phaseIndex: 0,
      snapshotType: "standard",
      dimension: null,
      regressionAdjustmentEnabled: false,
      orgPriorSettings: undefined,
      orgDisabledPrecomputedDimensions: true,
      settingsForSnapshotMetrics,
      metricMap,
      factTableMap,
      metricGroups: [],
      incrementalRefreshModel,
      datasource,
    });

    const metricForSnapshot = snapshotSettings.metricSettings.find(
      (m) => m.id === "m1",
    )!;
    const currentMetricHash = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
      metricSettings: metricForSnapshot,
    });
    const staleMetricHash = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
      metricSettings: {
        ...metricForSnapshot,
        computedSettings: {
          ...metricForSnapshot.computedSettings!,
          windowSettings: {
            ...metricForSnapshot.computedSettings!.windowSettings,
            windowValue: 7,
          },
        },
      } as MetricForSnapshot,
    });
    expect(staleMetricHash).not.toEqual(currentMetricHash);

    const experimentSettingsHash =
      getExperimentSettingsHashForIncrementalRefresh(snapshotSettings);

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        ...incrementalRefreshModel,
        experimentSettingsHash,
        metricSources: [
          {
            ...persistedMetricSources[0],
            metrics: [{ id: "m1", settingsHash: staleMetricHash }],
          },
        ],
      }),
    } as never;

    const plan = await planSnapshot({
      experiment,
      context,
      type: "standard",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics,
      metricMap,
      factTableMap,
    });

    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-update" }),
    );
    expect(plan.runnerKind).toBe("incremental");
    expect(plan.fullRefresh).toBe(false);
    expect(plan.incrementalFallbackReason).toBeNull();

    const plannedMetric = plan.snapshot.settings.metricSettings.find(
      (m) => m.id === "m1",
    )!;
    const plannedCurrentHash = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
      metricSettings: plannedMetric,
    });
    expect(plannedCurrentHash).toEqual(currentMetricHash);
    expect(
      getFactTablesNeedingRebuild({
        existingMetricSources: [
          {
            ...persistedMetricSources[0],
            metrics: [{ id: "m1", settingsHash: staleMetricHash }],
          },
        ],
        desiredFanOut: planMetricFanOut([metric]),
        currentMetricSettingsHashes: new Map([["m1", plannedCurrentHash]]),
      }),
    ).toEqual(new Set(["ft_a"]));
  });

  it("does not promote to full refresh when stale config is detected outside the scheduled job", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    const staleConfigMessage =
      "The experiment configuration is outdated. Please run a Full Refresh.";
    assertIncrementalRefreshPrerequisitesMock.mockRejectedValue(
      new ExperimentIncrementalPipelineRequiresFullRefreshError(
        staleConfigMessage,
      ),
    );

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "standard",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledTimes(1);
    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-update" }),
    );
    expect(assertIncrementalRefreshPrerequisitesMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-fullRefresh" }),
    );
    expect(plan.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(staleConfigMessage);
    expect(plan.fullRefresh).toBe(false);
    expect(plan.fullRefreshReason).toBeNull();
  });

  it("runs a scheduled incremental update when prerequisites pass", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "current_hash",
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "standard",
      triggeredBy: "schedule",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledTimes(1);
    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-update" }),
    );
    expect(plan.runnerKind).toBe("incremental");
    expect(plan.fullRefresh).toBe(false);
    expect(plan.fullRefreshReason).toBeNull();
    expect(plan.incrementalFallbackReason).toBeNull();
  });

  it("promotes the scheduled job to a full refresh when incremental state is outdated", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    const staleConfigMessage =
      "The experiment configuration is outdated. Please run a Full Refresh.";
    // First pass (main-update) rejects with the outdated-config error; the
    // full-refresh retry succeeds.
    assertIncrementalRefreshPrerequisitesMock
      .mockRejectedValueOnce(
        new ExperimentIncrementalPipelineRequiresFullRefreshError(
          staleConfigMessage,
        ),
      )
      .mockResolvedValueOnce(undefined as never);

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "standard",
      triggeredBy: "schedule",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ analysisType: "main-update" }),
    );
    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ analysisType: "main-fullRefresh" }),
    );
    // The incremental runner is kept and promoted to a full refresh instead of
    // silently downgrading to the non-incremental results runner.
    expect(plan.runnerKind).toBe("incremental");
    expect(plan.fullRefresh).toBe(true);
    expect(plan.fullRefreshReason).toBe(staleConfigMessage);
    expect(plan.incrementalFallbackReason).toBeNull();
  });

  it("falls back to results for the scheduled job when even a full refresh is unsupported", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    assertIncrementalRefreshPrerequisitesMock
      .mockRejectedValueOnce(
        new ExperimentIncrementalPipelineRequiresFullRefreshError(
          "The experiment configuration is outdated. Please run a Full Refresh.",
        ),
      )
      .mockRejectedValueOnce(new Error("metric not compatible"));

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "standard",
      triggeredBy: "schedule",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledTimes(2);
    expect(plan.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe("metric not compatible");
    expect(plan.fullRefresh).toBe(false);
    expect(plan.fullRefreshReason).toBeNull();
  });

  it("records exploratory provenance from materializedBySnapshotId when present", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const materializedBySnapshotId = "snap_pipeline_producer";
    const producerDateCreated = new Date("2025-01-10T12:00:00.000Z");
    findSnapshotByIdMock.mockResolvedValue({
      id: materializedBySnapshotId,
      dateCreated: producerDateCreated,
    } as never);

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "current_hash",
        materializedBySnapshotId,
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "exploratory",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings({
        dimensions: ["dim_country"],
      }),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.runnerKind).toBe("incremental-exploratory");
    expect(findSnapshotByIdMock).toHaveBeenCalledWith(
      context,
      materializedBySnapshotId,
    );
    expect(plan.snapshot.sourceSnapshotId).toBe(materializedBySnapshotId);
    expect(plan.snapshot.sourceSnapshotDateCreated).toBe(producerDateCreated);
    expect(getLatestSuccessfulSnapshotMock).toHaveBeenCalled();
  });

  it("leaves exploratory provenance unset when materializedBySnapshotId is null", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "current_hash",
        materializedBySnapshotId: null,
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "exploratory",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings({
        dimensions: ["dim_country"],
      }),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.runnerKind).toBe("incremental-exploratory");
    expect(findSnapshotByIdMock).not.toHaveBeenCalled();
    expect(getLatestSuccessfulSnapshotMock).not.toHaveBeenCalled();
    expect(plan.snapshot.sourceSnapshotId).toBeUndefined();
    expect(plan.snapshot.sourceSnapshotDateCreated).toBeUndefined();
  });

  describe("getMetricSnapshotSettings read contract", () => {
    it("applies a positive override stddev", () => {
      const { metricSnapshotSettings } = getMetricSnapshotSettings({
        metric: factMetricFactory.build({ id: "m1" }),
        denominatorMetrics: [],
        experimentRegressionAdjustmentEnabled: false,
        metricOverrides: [
          { id: "m1", properPriorOverride: true, properPriorStdDev: 0.5 },
        ],
      });
      expect(metricSnapshotSettings.properPriorStdDev).toBe(0.5);
    });
  });

  it("rethrows ExperimentIncrementalPipelineRequiresFullRefreshError when outdated and prompting is enabled", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    const staleConfigMessage =
      "The experiment configuration is outdated. Please run a Full Refresh.";
    assertIncrementalRefreshPrerequisitesMock.mockRejectedValue(
      new ExperimentIncrementalPipelineRequiresFullRefreshError(
        staleConfigMessage,
      ),
    );

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      }),
    } as never;

    await expect(
      planSnapshot({
        experiment: makeExperiment(),
        context,
        type: "standard",
        triggeredBy: "manual",
        phaseIndex: 0,
        useCache: true,
        defaultAnalysisSettings: makeAnalysisSettings(),
        additionalAnalysisSettings: [],
        settingsForSnapshotMetrics: [],
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      }),
    ).rejects.toThrow(ExperimentIncrementalPipelineRequiresFullRefreshError);
  });

  it("falls back instead of throwing when a non-outdated error occurs even if prompting is enabled", async () => {
    getDataSourceByIdMock.mockResolvedValue(
      makeDatasource({
        settings: {
          queries: {},
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
          },
        },
      }),
    );
    assertIncrementalRefreshPrerequisitesMock.mockRejectedValue(
      new Error("metric not compatible"),
    );

    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      }),
    } as never;

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context,
      type: "standard",
      triggeredBy: "manual",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe("metric not compatible");
  });

  function makeExploratoryContext() {
    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentId: jest.fn().mockResolvedValue({
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "hash_abc",
        metricSources: [],
      }),
    } as never;
    return context;
  }

  it("uses the incremental-exploratory runner when the Overall units table does not require a full refresh", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );
    exploratoryOverallRequiresFullRefreshMock.mockReturnValue(false);

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context: makeExploratoryContext(),
      type: "exploratory",
      triggeredBy: "manual",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings({
        dimensions: ["exp:country"],
      }),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.runnerKind).toBe("incremental-exploratory");
  });

  it("throws ExperimentIncrementalPipelineRequiresFullRefreshError when the Overall units table requires a full refresh and prompting enabled", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );
    exploratoryOverallRequiresFullRefreshMock.mockReturnValue(true);

    await expect(
      planSnapshot({
        experiment: makeExperiment(),
        context: makeExploratoryContext(),
        type: "exploratory",
        triggeredBy: "manual",
        phaseIndex: 0,
        useCache: true,
        defaultAnalysisSettings: makeAnalysisSettings({
          dimensions: ["exp:country"],
        }),
        additionalAnalysisSettings: [],
        settingsForSnapshotMetrics: [],
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      }),
    ).rejects.toThrow(ExperimentIncrementalPipelineRequiresFullRefreshError);
  });

  it("falls back to results runner when the Overall units table requires a full refresh and triggered by a background job", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );
    exploratoryOverallRequiresFullRefreshMock.mockReturnValue(true);

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context: makeExploratoryContext(),
      type: "exploratory",
      triggeredBy: "schedule",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings({
        dimensions: ["exp:country"],
      }),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(
      "Overall Results need a full refresh; running non-incremental update instead of reading stale data.",
    );
  });
});
