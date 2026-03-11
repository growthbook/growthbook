import { ExperimentMetricInterface } from "shared/experiments";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { MetricSnapshotSettings } from "shared/types/report";
import { ApiReqContext } from "back-end/types/api";
import {
  startSnapshotFromPlan,
  PlannedExperimentSnapshot,
} from "back-end/src/services/experiments";
import { requestExperimentSnapshotFromPlan } from "back-end/src/controllers/experiments";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { createExperimentSnapshotModel } from "back-end/src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  getFactTableMap,
  FactTableMap,
} from "back-end/src/models/FactTableModel";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  createExperimentSnapshotModel: jest.fn(),
  findSnapshotById: jest.fn(),
  updateSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn(),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTableMap: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock("shared/experiments", () => ({
  ...jest.requireActual("shared/experiments"),
  expandAllSliceMetricsInMap: jest.fn(),
}));

jest.mock("back-end/src/queryRunners/ExperimentResultsQueryRunner", () => ({
  ExperimentResultsQueryRunner: jest
    .fn()
    .mockImplementation((_context, snapshot) => ({
      model: snapshot,
      startAnalysis: jest.fn(),
    })),
}));

jest.mock(
  "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner",
  () => ({
    ExperimentIncrementalRefreshQueryRunner: jest
      .fn()
      .mockImplementation((_context, snapshot) => ({
        model: snapshot,
        startAnalysis: jest.fn(),
      })),
  }),
);

jest.mock(
  "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner",
  () => ({
    ExperimentIncrementalRefreshExploratoryQueryRunner: jest
      .fn()
      .mockImplementation((_context, snapshot) => ({
        model: snapshot,
        startAnalysis: jest.fn(),
      })),
  }),
);

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
const getMetricMapMock = getMetricMap as jest.MockedFunction<
  typeof getMetricMap
>;
const getFactTableMapMock = getFactTableMap as jest.MockedFunction<
  typeof getFactTableMap
>;

const resultsQueryRunnerMock =
  ExperimentResultsQueryRunner as unknown as jest.Mock;
const incrementalQueryRunnerMock =
  ExperimentIncrementalRefreshQueryRunner as unknown as jest.Mock;
const exploratoryQueryRunnerMock =
  ExperimentIncrementalRefreshExploratoryQueryRunner as unknown as jest.Mock;

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
      incrementalRefresh: {
        getCurrentExecutionSnapshotId: jest.fn().mockResolvedValue(null),
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
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
    ...overrides,
  } as ExperimentSnapshotAnalysisSettings;
}

function makePlan(
  overrides: Partial<PlannedExperimentSnapshot> = {},
): PlannedExperimentSnapshot {
  const defaultAnalysisSettings = makeAnalysisSettings();
  return {
    snapshot: {
      id: "snp_123",
      organization: "org_123",
      experiment: "exp_123",
      runStarted: new Date("2025-02-01T00:00:00.000Z"),
      error: "",
      dateCreated: new Date("2025-02-01T00:00:00.000Z"),
      phase: 0,
      queries: [],
      dimension: null,
      settings: {} as ExperimentSnapshotSettings,
      type: "standard",
      triggeredBy: "manual",
      unknownVariations: [],
      multipleExposures: 0,
      analyses: [
        {
          dateCreated: new Date("2025-02-01T00:00:00.000Z"),
          results: [],
          settings: defaultAnalysisSettings,
          status: "running",
        },
      ],
      status: "running",
    } as ExperimentSnapshotInterface,
    runnerKind: "results",
    useCache: true,
    fullRefresh: false,
    settingsForSnapshotMetrics: [] as MetricSnapshotSettings[],
    ...overrides,
  };
}

describe("snapshot lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDataSourceByIdMock.mockResolvedValue(makeDatasource());
    getSourceIntegrationObjectMock.mockReturnValue({} as never);
    createExperimentSnapshotModelMock.mockImplementation(
      async ({ data }) => data as ExperimentSnapshotInterface,
    );
    getMetricMapMock.mockResolvedValue(
      new Map<string, ExperimentMetricInterface>(),
    );
    getFactTableMapMock.mockResolvedValue(new Map() as FactTableMap);
  });

  it("creates a standard snapshot, persists it, and starts analysis", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan();
    const metricMap = new Map<string, ExperimentMetricInterface>();
    const factTableMap = new Map() as FactTableMap;

    await startSnapshotFromPlan({
      plan,
      context,
      experiment,
      metricMap,
      factTableMap,
    });

    // Records the snapshot attempt (schedules next refresh)
    expect(updateExperimentMock).toHaveBeenCalledWith({
      context,
      experiment,
      changes: expect.objectContaining({
        lastSnapshotAttempt: expect.any(Date),
        nextSnapshotAttempt: expect.any(Date),
        autoSnapshots: true,
      }),
    });

    // Persists the snapshot document
    expect(createExperimentSnapshotModelMock).toHaveBeenCalledWith({
      data: plan.snapshot,
    });

    // Instantiates the correct query runner
    expect(resultsQueryRunnerMock).toHaveBeenCalledWith(
      context,
      plan.snapshot,
      expect.any(Object),
      true, // useCache from plan
    );

    // Starts analysis with the right props
    const queryRunner = resultsQueryRunnerMock.mock.results[0].value;
    expect(queryRunner.startAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotType: "standard",
        snapshotSettings: plan.snapshot.settings,
        metricMap,
        factTableMap,
        queryParentId: plan.snapshot.id,
      }),
    );
  });

  it("passes fullRefresh to the incremental runner for standard snapshots", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan({
      runnerKind: "incremental",
      fullRefresh: true,
    });

    await startSnapshotFromPlan({
      plan,
      context,
      experiment,
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    const queryRunner = incrementalQueryRunnerMock.mock.results[0].value;
    expect(queryRunner.startAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: experiment.id,
        fullRefresh: true,
        snapshotType: "standard",
      }),
    );
  });

  it("uses the exploratory incremental runner for exploratory snapshots", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan({
      runnerKind: "incremental-exploratory",
      snapshot: {
        ...makePlan().snapshot,
        type: "exploratory",
      },
    });

    await startSnapshotFromPlan({
      plan,
      context,
      experiment,
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(exploratoryQueryRunnerMock).toHaveBeenCalledWith(
      context,
      plan.snapshot,
      expect.any(Object),
      false,
    );

    const queryRunner = exploratoryQueryRunnerMock.mock.results[0].value;
    expect(queryRunner.startAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: experiment.id,
        snapshotType: "exploratory",
      }),
    );
  });

  it("skips scheduling exploratory bandit snapshots", async () => {
    const context = makeContext();
    const experiment = makeExperiment({
      type: "multi-armed-bandit",
      banditBurnInValue: 1,
      banditBurnInUnit: "days",
      banditScheduleValue: 1,
      banditScheduleUnit: "days",
    });
    const plan = makePlan({
      snapshot: {
        ...makePlan().snapshot,
        type: "exploratory",
      },
    });

    await startSnapshotFromPlan({
      plan,
      context,
      experiment,
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    // recordExperimentSnapshotAttempt skips scheduling for non-standard bandit snapshots
    expect(updateExperimentMock).not.toHaveBeenCalled();
    // But analysis still runs
    expect(resultsQueryRunnerMock).toHaveBeenCalled();
  });

  it("releases incremental lock when startAnalysis fails", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan({ runnerKind: "incremental" });

    incrementalQueryRunnerMock.mockImplementationOnce(
      (_context: unknown, snapshot: ExperimentSnapshotInterface) => ({
        model: snapshot,
        startAnalysis: jest.fn().mockRejectedValue(new Error("Query failed")),
      }),
    );

    await expect(
      startSnapshotFromPlan({
        plan,
        context,
        experiment,
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      }),
    ).rejects.toThrow("Query failed");

    expect(context.models.incrementalRefresh.releaseLock).toHaveBeenCalledWith(
      experiment.id,
      "snp_123",
    );
  });

  it("releases incremental lock after runner completes via requestExperimentSnapshotFromPlan", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan({ runnerKind: "incremental" });

    // waitForResults resolves immediately (simulates successful completion)
    const waitForResults = jest.fn().mockResolvedValue(undefined);
    incrementalQueryRunnerMock.mockImplementationOnce(
      (_context: unknown, snapshot: ExperimentSnapshotInterface) => ({
        model: snapshot,
        startAnalysis: jest.fn(),
        waitForResults,
      }),
    );

    const { queryRunner } = await requestExperimentSnapshotFromPlan({
      plan,
      context: context as unknown as Parameters<
        typeof requestExperimentSnapshotFromPlan
      >[0]["context"],
      experiment,
    });

    expect(queryRunner).toBeDefined();
    expect(context.models.incrementalRefresh.acquireLock).toHaveBeenCalledWith(
      experiment.id,
      "snp_123",
    );

    // Wait for the fire-and-forget finally to complete
    await waitForResults();
    // Flush microtask queue so the .finally() handler runs
    await new Promise((r) => setImmediate(r));

    expect(context.models.incrementalRefresh.releaseLock).toHaveBeenCalledWith(
      experiment.id,
      "snp_123",
    );
  });
});
