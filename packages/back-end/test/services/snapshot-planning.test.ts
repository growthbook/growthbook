import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import { ApiReqContext } from "back-end/types/api";
import { validateIncrementalPipeline } from "back-end/src/enterprise/services/data-pipeline";
import { planSnapshot } from "back-end/src/services/experiments";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { createExperimentSnapshotModel } from "back-end/src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import { FactTableMap } from "back-end/src/models/FactTableModel";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  createExperimentSnapshotModel: jest.fn(),
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

jest.mock("back-end/src/enterprise/services/data-pipeline", () => ({
  validateIncrementalPipeline: jest.fn(),
}));

const updateExperimentMock = updateExperiment as jest.MockedFunction<
  typeof updateExperiment
>;
const createExperimentSnapshotModelMock =
  createExperimentSnapshotModel as jest.MockedFunction<
    typeof createExperimentSnapshotModel
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
const validateIncrementalPipelineMock =
  validateIncrementalPipeline as jest.MockedFunction<
    typeof validateIncrementalPipeline
  >;

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
    validateIncrementalPipelineMock.mockRejectedValue(
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

    expect(validateIncrementalPipelineMock).toHaveBeenCalled();
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
    validateIncrementalPipelineMock.mockResolvedValue(undefined as never);

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
      "No prior incremental refresh state for this experiment.",
    );
    expect(validateIncrementalPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-fullRefresh" }),
    );
  });

  it("falls back to the results runner when incremental state is outdated", async () => {
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
    validateIncrementalPipelineMock.mockRejectedValue(
      new Error(staleConfigMessage),
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

    expect(validateIncrementalPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({ analysisType: "main-update" }),
    );
    expect(validateIncrementalPipelineMock).toHaveBeenCalledTimes(1);
    expect(plan.runnerKind).toBe("results");
    expect(plan.incrementalFallbackReason).toBe(staleConfigMessage);
    expect(plan.fullRefresh).toBe(false);
    expect(plan.fullRefreshReason).toBeNull();
  });
});
