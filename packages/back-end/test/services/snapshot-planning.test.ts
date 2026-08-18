import {
  ExperimentMetricInterface,
  expandDerivedMetricsInMap,
  getMetricSnapshotSettings,
} from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import { DataSourceInterface } from "shared/types/datasource";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import {
  ExperimentSnapshotReportInterface,
  LegacyExperimentReportArgs,
  MetricSnapshotSettings,
} from "shared/types/report";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { ApiReqContext } from "back-end/types/api";
import {
  assertIncrementalRefreshPrerequisites,
  exploratoryOverallRequiresFullRefresh,
} from "back-end/src/enterprise/services/data-pipeline";
import {
  BadRequestError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
} from "back-end/src/util/errors";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  createExperimentSnapshot,
  getSnapshotSettings,
  planSnapshot,
} from "back-end/src/services/experiments";
import { planMetricFanOut } from "back-end/src/services/experimentQueries/planMetricFanOut";
import { getQueryableMetricsFromSnapshotSettings } from "back-end/src/services/experimentQueries/experimentQueries";
import {
  getReportSnapshotSettings,
  getSnapshotSettingsFromReportArgs,
} from "back-end/src/services/reports";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  createExperimentSnapshotModel,
  findSnapshotById,
  getLatestSuccessfulSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import {
  FactTableMap,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
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

jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricById: jest.fn(),
  getMetricMap: jest.fn(),
  getMetricsByIds: jest.fn(),
  insertMetric: jest.fn(),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTableMap: jest.fn(),
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
  legacyDocDescribesPhase: (
    args: Parameters<
      (typeof import("back-end/src/enterprise/services/data-pipeline"))["legacyDocDescribesPhase"]
    >[0],
  ) =>
    jest
      .requireActual<
        typeof import("back-end/src/enterprise/services/data-pipeline")
      >("back-end/src/enterprise/services/data-pipeline")
      .legacyDocDescribesPhase(args),
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
const getMetricMapMock = getMetricMap as jest.MockedFunction<
  typeof getMetricMap
>;
const getFactTableMapMock = getFactTableMap as jest.MockedFunction<
  typeof getFactTableMap
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

function wireIncrementalRefreshState(
  context: ApiReqContext,
  {
    phaseDoc = null,
    legacyDoc = null,
  }: { phaseDoc?: unknown; legacyDoc?: unknown } = {},
): void {
  context.models.incrementalRefresh = {
    getByExperimentIdAndPhase: jest.fn().mockResolvedValue(phaseDoc),
    getLegacyByExperimentIdWithoutPhase: jest.fn().mockResolvedValue(legacyDoc),
  } as never;
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

function makeTwoPhaseExperiment(): ExperimentInterface {
  return makeExperiment({
    phases: [
      {
        dateStarted: new Date("2025-01-01T00:00:00.000Z"),
        variationWeights: [0.5, 0.5],
      },
      {
        dateStarted: new Date("2025-03-01T00:00:00.000Z"),
        variationWeights: [0.5, 0.5],
      },
    ],
  });
}

function settingsHashForPhase({
  experiment,
  datasource,
  phaseIndex,
}: {
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  phaseIndex: number;
}): string {
  return getExperimentSettingsHashForIncrementalRefresh(
    getSnapshotSettings({
      experiment,
      phaseIndex,
      snapshotType: "standard",
      dimension: null,
      regressionAdjustmentEnabled: false,
      orgPriorSettings: undefined,
      orgDisabledPrecomputedDimensions: true,
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
      metricGroups: [],
      incrementalRefreshModel: null,
      datasource,
    }),
  );
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
    getMetricMapMock.mockResolvedValue(new Map());
    getFactTableMapMock.mockResolvedValue(new Map() as FactTableMap);
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

    expect(plan.snapshot.runnerKind).toBe("results");
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

  // Exposure query identifies units by user_id; ft_joinable shares that id
  // type, ft_orphan does not and the datasource has no identity join for it.
  // Both metrics carry auto slices, so each expands into derived metrics.
  function makeJoinabilityFixture() {
    const datasource = makeDatasource({
      settings: {
        queries: {
          exposure: [
            {
              id: "exposure_user",
              name: "Users",
              userIdType: "user_id",
              query: "SELECT * FROM exposures",
              dimensions: [],
            },
          ],
        },
      } as unknown as DataSourceInterface["settings"],
    });
    const sliceColumn = {
      column: "country",
      datatype: "string" as const,
      name: "country",
      description: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      numberFormat: "" as const,
      deleted: false,
      isAutoSliceColumn: true,
      autoSlices: ["us", "ca"],
    };
    const joinableTable = factTableFactory.build({
      id: "ft_joinable",
      userIdTypes: ["user_id"],
      columns: [sliceColumn],
    });
    const orphanTable = factTableFactory.build({
      id: "ft_orphan",
      userIdTypes: ["device_id"],
      columns: [sliceColumn],
    });
    const factTableMap = new Map([
      [joinableTable.id, joinableTable],
      [orphanTable.id, orphanTable],
    ]) as FactTableMap;
    const joinableMetric = factMetricFactory.build({
      id: "m_joinable",
      numerator: { factTableId: "ft_joinable", column: "$$count" },
      metricAutoSlices: ["country"],
    });
    const orphanMetric = factMetricFactory.build({
      id: "m_orphan",
      numerator: { factTableId: "ft_orphan", column: "$$count" },
      metricAutoSlices: ["country"],
    });
    const metricMap = new Map<string, ExperimentMetricInterface>([
      [joinableMetric.id, joinableMetric],
      [orphanMetric.id, orphanMetric],
    ]);
    const settingsForSnapshotMetrics = [joinableMetric, orphanMetric].map(
      (metric) =>
        getMetricSnapshotSettings({
          metric,
          denominatorMetrics: [],
          experimentRegressionAdjustmentEnabled: false,
        }).metricSnapshotSettings,
    );
    return { datasource, factTableMap, metricMap, settingsForSnapshotMetrics };
  }

  function expectOnlyJoinableMetricsAnalyzed(
    snapshotSettings: ExperimentSnapshotSettings,
    metricMap: Map<string, ExperimentMetricInterface>,
  ) {
    const analyzedIds = snapshotSettings.metricSettings.map((m) => m.id);
    expect(snapshotSettings.goalMetrics).toEqual(["m_joinable"]);
    expect(analyzedIds).toContain("m_joinable");
    expect(analyzedIds.some((id) => id.startsWith("m_joinable?dim:"))).toBe(
      true,
    );
    expect(analyzedIds.filter((id) => id.startsWith("m_orphan"))).toEqual([]);

    // The query runner selects metrics to query from these settings; the
    // orphan's slices would otherwise reach the SQL builder, which has no way
    // to join ft_orphan to the exposure units and fails the whole snapshot.
    const queried = getQueryableMetricsFromSnapshotSettings(
      snapshotSettings,
      metricMap,
    ).map((m) => m.id);
    expect(queried.some((id) => id.startsWith("m_joinable?dim:"))).toBe(true);
    expect(queried.filter((id) => id.startsWith("m_orphan"))).toEqual([]);
  }

  // Callers reach getSnapshotSettings both with a fresh metricMap and with one
  // that was already expanded from the full experiment (e.g. the map built in
  // createExperimentSnapshotFromPlan is reused for dashboard snapshots), so
  // scrubbing must hold either way.
  describe.each([
    ["a fresh metricMap", false],
    ["a metricMap already expanded from the unscrubbed experiment", true],
  ])("snapshot settings with %s", (_label, preExpand) => {
    it("do not analyze unjoinable metrics or their slices", () => {
      const {
        datasource,
        factTableMap,
        metricMap,
        settingsForSnapshotMetrics,
      } = makeJoinabilityFixture();
      const experiment = makeExperiment({
        exposureQueryId: "exposure_user",
        goalMetrics: ["m_joinable", "m_orphan"],
        metricOverrides: [],
      });
      if (preExpand) {
        expandDerivedMetricsInMap({
          metricMap,
          factTableMap,
          experiment,
          metricGroups: [],
        });
      }

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
        incrementalRefreshModel: null,
        datasource,
      });

      expectOnlyJoinableMetricsAnalyzed(snapshotSettings, metricMap);
    });
  });

  it("report settings drop unjoinable metrics and their slices", () => {
    const { datasource, factTableMap, metricMap, settingsForSnapshotMetrics } =
      makeJoinabilityFixture();
    const experimentAnalysisSettings = {
      exposureQueryId: "exposure_user",
      goalMetrics: ["m_joinable", "m_orphan"],
      secondaryMetrics: [],
      guardrailMetrics: [],
      metricOverrides: [],
    };
    // Report generation expands derived metrics from the unscrubbed report
    // settings before building the snapshot settings.
    expandDerivedMetricsInMap({
      metricMap,
      factTableMap,
      experiment: experimentAnalysisSettings,
      metricGroups: [],
    });

    const snapshotSettings = getReportSnapshotSettings({
      report: {
        experimentAnalysisSettings,
        experimentMetadata: {
          phases: [{ variationWeights: [0.5, 0.5] }],
          variations: [{ key: "0" }, { key: "1" }],
        },
      } as unknown as ExperimentSnapshotReportInterface,
      analysisSettings: makeAnalysisSettings(),
      phaseIndex: 0,
      orgPriorSettings: undefined,
      settingsForSnapshotMetrics,
      metricMap,
      factTableMap,
      metricGroups: [],
      datasource,
    });

    expectOnlyJoinableMetricsAnalyzed(snapshotSettings, metricMap);
  });

  it("expands legacy report metric groups consistently", () => {
    const metricGroups = [
      { id: "mg_goal", metrics: ["m_goal_a", "m_goal_b"] },
      { id: "mg_secondary", metrics: ["m_secondary"] },
      { id: "mg_guardrail", metrics: ["m_guardrail_a", "m_guardrail_b"] },
    ].map(
      ({ id, metrics }): MetricGroupInterface => ({
        id,
        organization: "org_123",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        owner: "",
        name: id,
        description: "",
        tags: [],
        projects: [],
        metrics,
        datasource: "ds_123",
        archived: false,
      }),
    );
    const metrics = metricGroups
      .flatMap((group) => group.metrics)
      .map((id) => factMetricFactory.build({ id }));
    const metricMap = new Map<string, ExperimentMetricInterface>(
      metrics.map((metric) => [metric.id, metric]),
    );
    const args: LegacyExperimentReportArgs = {
      trackingKey: "experiment",
      datasource: "ds_123",
      exposureQueryId: "exposure",
      startDate: new Date(),
      variations: [
        { id: "0", index: 0, name: "Control", weight: 0.5 },
        { id: "1", index: 1, name: "Treatment", weight: 0.5 },
      ],
      goalMetrics: ["mg_goal"],
      secondaryMetrics: ["mg_secondary"],
      guardrailMetrics: ["mg_guardrail"],
      decisionFrameworkSettings: {},
    };

    const { snapshotSettings, analysisSettings } =
      getSnapshotSettingsFromReportArgs(
        args,
        metricMap,
        undefined,
        undefined,
        metricGroups,
      );

    expect(snapshotSettings.metricSettings.map((metric) => metric.id)).toEqual([
      "m_goal_a",
      "m_goal_b",
      "m_secondary",
      "m_guardrail_a",
      "m_guardrail_b",
    ]);
    expect(snapshotSettings.goalMetrics).toEqual(["m_goal_a", "m_goal_b"]);
    expect(snapshotSettings.secondaryMetrics).toEqual(["m_secondary"]);
    expect(snapshotSettings.guardrailMetrics).toEqual([
      "m_guardrail_a",
      "m_guardrail_b",
    ]);
    expect(analysisSettings.numGoalMetrics).toBe(2);
    expect(analysisSettings.numGuardrailMetrics).toBe(2);
  });

  it("rejects a snapshot for an experiment with no metrics without persisting a record", async () => {
    await expect(
      createExperimentSnapshot({
        context: makeContext(),
        experiment: makeExperiment({
          goalMetrics: [],
          secondaryMetrics: [],
          guardrailMetrics: [],
        }),
        datasource: makeDatasource(),
        dimension: undefined,
        phase: 0,
        useCache: false,
      }),
    ).rejects.toThrow(BadRequestError);

    expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
  });

  it("rejects a snapshot when none of the selected metrics can be resolved", async () => {
    await expect(
      createExperimentSnapshot({
        context: makeContext(),
        experiment: makeExperiment({
          goalMetrics: ["fact__deleted"],
          metricOverrides: [],
        }),
        datasource: makeDatasource(),
        dimension: undefined,
        phase: 0,
        useCache: false,
      }),
    ).rejects.toThrow(BadRequestError);

    expect(getMetricMapMock).toHaveBeenCalled();
    expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
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
    wireIncrementalRefreshState(context, {
      phaseDoc: { unitsTableFullName: "db.schema.units_exp_123" },
    });

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
    expect(plan.snapshot.runnerKind).toBe("results");
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
    wireIncrementalRefreshState(context, { phaseDoc: null });

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

    expect(plan.snapshot.runnerKind).toBe("incremental-full");
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

  it("claims a pre-phase document for the phase whose settings hash it matches, even when a newer phase exists", async () => {
    const datasource = makeIncrementalDatasource();
    wireIncrementalIntegration(datasource);
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const experiment = makeTwoPhaseExperiment();
    const phaseZeroHash = settingsHashForPhase({
      experiment,
      datasource,
      phaseIndex: 0,
    });
    // The hash covers the phase start date, so a document can only be claimed by
    // one of these two phases. Equal hashes would make both tests vacuous.
    expect(phaseZeroHash).not.toEqual(
      settingsHashForPhase({ experiment, datasource, phaseIndex: 1 }),
    );

    const context = makeContext();
    wireIncrementalRefreshState(context, {
      legacyDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: phaseZeroHash,
      },
    });

    const plan = await planSnapshot({
      experiment,
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

    expect(
      context.models.incrementalRefresh.getLegacyByExperimentIdWithoutPhase,
    ).toHaveBeenCalledWith("exp_123");
    expect(plan.snapshot.runnerKind).toBe("incremental-update");
    expect(plan.fullRefresh).toBe(false);
    expect(plan.fullRefreshReason).toBeNull();
  });

  it("refuses a pre-phase document whose settings hash belongs to a different phase", async () => {
    const datasource = makeIncrementalDatasource();
    wireIncrementalIntegration(datasource);
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const experiment = makeTwoPhaseExperiment();
    const phaseZeroHash = settingsHashForPhase({
      experiment,
      datasource,
      phaseIndex: 0,
    });
    expect(phaseZeroHash).not.toEqual(
      settingsHashForPhase({ experiment, datasource, phaseIndex: 1 }),
    );

    const context = makeContext();
    wireIncrementalRefreshState(context, {
      legacyDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: phaseZeroHash,
      },
    });

    const plan = await planSnapshot({
      experiment,
      context,
      type: "standard",
      triggeredBy: "manual-dashboard",
      phaseIndex: 1,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(
      context.models.incrementalRefresh.getLegacyByExperimentIdWithoutPhase,
    ).toHaveBeenCalledWith("exp_123");
    expect(plan.snapshot.runnerKind).toBe("incremental-full");
    expect(plan.fullRefresh).toBe(true);
    expect(plan.fullRefreshReason).toBe(
      "No prior Incremental Pipeline state for this experiment.",
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        ...incrementalRefreshModel,
        experimentSettingsHash,
        metricSources: [
          {
            ...persistedMetricSources[0],
            metrics: [{ id: "m1", settingsHash: staleMetricHash }],
          },
        ],
      },
    });

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
    expect(plan.snapshot.runnerKind).toBe("incremental-update");
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      },
    });

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
    expect(plan.snapshot.runnerKind).toBe("results");
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "current_hash",
      },
    });

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
    expect(plan.snapshot.runnerKind).toBe("incremental-update");
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      },
    });

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
    expect(plan.snapshot.runnerKind).toBe("incremental-full");
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      },
    });

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
    expect(plan.snapshot.runnerKind).toBe("results");
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "current_hash",
        materializedBySnapshotId,
      },
    });

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

    expect(plan.snapshot.runnerKind).toBe("incremental-exploratory");
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "current_hash",
        materializedBySnapshotId: null,
      },
    });

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

    expect(plan.snapshot.runnerKind).toBe("incremental-exploratory");
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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      },
    });

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
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "stale_hash",
      },
    });

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

    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe("metric not compatible");
  });

  function makeExploratoryContext() {
    const context = makeContext();
    wireIncrementalRefreshState(context, {
      phaseDoc: {
        unitsTableFullName: "db.schema.units_exp_123",
        experimentSettingsHash: "hash_abc",
        metricSources: [],
      },
    });
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

    expect(plan.snapshot.runnerKind).toBe("incremental-exploratory");
    // Healthy breakdown running incrementally already, nothing to unblock.
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(false);
  });

  it("throws ExperimentIncrementalPipelineRequiresFullRefreshError when the Overall units table requires a full refresh and prompting enabled", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );
    exploratoryOverallRequiresFullRefreshMock.mockReturnValue(true);

    const planning = planSnapshot({
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

    await expect(planning).rejects.toThrow(
      ExperimentIncrementalPipelineRequiresFullRefreshError,
    );
    await expect(planning).rejects.toThrow(
      "Overall Results require a full refresh before Dimension Results can be updated.",
    );
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

    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(
      "Overall Results need a full refresh; running non-incremental update instead of reading stale data.",
    );
    // A Full Refresh of Overall Results would let this breakdown run
    // incrementally, so the dashboard fan-out is told to rebuild once.
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(true);
  });

  function makeNeverMaterializedContext() {
    const context = makeContext();
    context.models.incrementalRefresh = {
      getByExperimentIdAndPhase: jest.fn().mockResolvedValue(null),
      getLegacyByExperimentIdWithoutPhase: jest.fn().mockResolvedValue(null),
    } as never;
    return context;
  }

  function makeNonLatestPhaseExperiment(): ExperimentInterface {
    const experiment = makeExperiment();
    return {
      ...experiment,
      phases: [experiment.phases[0], { ...experiment.phases[0] }],
    };
  }

  function useRealIncrementalPrerequisites(): void {
    assertIncrementalRefreshPrerequisitesMock.mockImplementation(
      jest.requireActual<
        typeof import("back-end/src/enterprise/services/data-pipeline")
      >("back-end/src/enterprise/services/data-pipeline")
        .assertIncrementalRefreshPrerequisites,
    );
  }

  it("throws ExperimentIncrementalPipelineRequiresFullRefreshError for a manual dimension request when Overall Results were never materialized", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());

    const planning = planSnapshot({
      experiment: makeExperiment(),
      context: makeNeverMaterializedContext(),
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

    await expect(planning).rejects.toThrow(
      ExperimentIncrementalPipelineRequiresFullRefreshError,
    );
    await expect(planning).rejects.toThrow(
      "Overall Results have not been computed yet, so there is no units table for a dimension breakdown to read.",
    );
  });

  it("does not block a dimensionless request on the Overall Results that request would itself materialize", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context: makeNeverMaterializedContext(),
      type: "exploratory",
      triggeredBy: "manual",
      phaseIndex: 0,
      useCache: true,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(
      "No materialized units table yet for Overall Results.",
    );
    // A dimensionless request is what materializes the table, so it is never
    // "blocked on Overall Results" and never asks the fan-out to rebuild.
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(false);
  });

  it("does not demand an Overall Results refresh the pipeline would reject for the same experiment", async () => {
    orgHasPremiumFeatureMock.mockReturnValue(true);
    wireIncrementalIntegration(makeIncrementalDatasource());
    useRealIncrementalPrerequisites();

    const plan = await planSnapshot({
      experiment: makeExperiment({ skipPartialData: true }),
      context: makeNeverMaterializedContext(),
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

    expect(assertIncrementalRefreshPrerequisitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-fullRefresh" }),
    );
    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(
      "'Exclude In-Progress Conversions' is not supported with Incremental Pipeline mode while in beta. Please select 'Include' in the Analysis Settings for Metric Conversion Windows.",
    );
    // A Full Refresh would be rejected for the same reason, so rebuilding
    // Overall would not help and the fan-out must not attempt it.
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(false);
  });

  it("does not demand an Overall Results refresh for a non-latest phase that would never materialize one", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );

    const plan = await planSnapshot({
      experiment: makeNonLatestPhaseExperiment(),
      context: makeNeverMaterializedContext(),
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

    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(
      "No materialized units table yet for Overall Results.",
    );
  });

  it("uses the phase-scoped units table for a non-latest phase when it is current", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );
    exploratoryOverallRequiresFullRefreshMock.mockReturnValue(false);

    const plan = await planSnapshot({
      experiment: makeNonLatestPhaseExperiment(),
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

    expect(plan.snapshot.runnerKind).toBe("incremental-exploratory");
    expect(plan.incrementalFallbackReason).toBeNull();
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(false);
  });

  it("does not demand an Overall Results refresh for a settings-drifted non-latest phase", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());
    assertIncrementalRefreshPrerequisitesMock.mockResolvedValue(
      undefined as never,
    );
    exploratoryOverallRequiresFullRefreshMock.mockReturnValue(true);

    const plan = await planSnapshot({
      experiment: makeNonLatestPhaseExperiment(),
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

    expect(exploratoryOverallRequiresFullRefreshMock).toHaveBeenCalledTimes(1);
    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(
      "The requested phase's materialized units table is stale; running a non-incremental update instead.",
    );
    // Overall Results never materialize for a non-latest phase, so a rebuild
    // would not help and the boolean stays false.
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(false);
  });

  it("falls back to results for a scheduled dimension request when Overall Results were never materialized", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context: makeNeverMaterializedContext(),
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

    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(
      "No materialized units table yet for Overall Results.",
    );
    // Dimension-blocked and fixable, so the fan-out is told to rebuild once.
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(true);
  });

  it("throws for a scheduled dimension request from a request path when Overall Results were never materialized", async () => {
    wireIncrementalIntegration(makeIncrementalDatasource());

    const planning = planSnapshot({
      experiment: makeExperiment(),
      context: makeNeverMaterializedContext(),
      type: "exploratory",
      triggeredBy: "schedule",
      phaseIndex: 0,
      useCache: true,
      throwIfRequiresFullRefresh: true,
      defaultAnalysisSettings: makeAnalysisSettings({
        dimensions: ["exp:country"],
      }),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    await expect(planning).rejects.toThrow(
      ExperimentIncrementalPipelineRequiresFullRefreshError,
    );
    await expect(planning).rejects.toThrow(
      "Overall Results have not been computed yet, so there is no units table for a dimension breakdown to read.",
    );
  });

  it("leaves a manual dimension request alone when the experiment is not covered by the Incremental Pipeline", async () => {
    getDataSourceByIdMock.mockResolvedValue(makeDatasource());
    getSourceIntegrationObjectMock.mockReturnValue({} as never);

    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context: makeNeverMaterializedContext(),
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

    expect(plan.snapshot.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBeNull();
    expect(assertIncrementalRefreshPrerequisitesMock).not.toHaveBeenCalled();
    // Not covered by the Incremental Pipeline at all, so there is nothing to
    // unblock.
    expect(plan.overallResultsFullRefreshWouldUnblock).toBe(false);
  });
});
