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
  createSnapshotFromPlan,
  PlannedExperimentSnapshot,
} from "back-end/src/services/experiments";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { createExperimentSnapshotModel } from "back-end/src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { ConcurrentIncrementalRefreshError } from "back-end/src/util/errors";

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
const updateExperimentDashboardsMock =
  updateExperimentDashboards as jest.MockedFunction<
    typeof updateExperimentDashboards
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
  });

  it("creates a standard snapshot, starts analysis, and refreshes dashboards", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan();
    const metricMap = new Map<string, ExperimentMetricInterface>();
    const factTableMap = new Map() as FactTableMap;

    await createSnapshotFromPlan({
      plan,
      context,
      experiment,
      metricMap,
      factTableMap,
    });

    expect(updateExperimentMock).toHaveBeenCalledWith({
      context,
      experiment,
      changes: expect.objectContaining({
        lastSnapshotAttempt: expect.any(Date),
        nextSnapshotAttempt: expect.any(Date),
        autoSnapshots: true,
      }),
    });
    expect(createExperimentSnapshotModelMock).toHaveBeenCalledWith({
      context,
      data: plan.snapshot,
    });
    expect(resultsQueryRunnerMock).toHaveBeenCalledWith(
      context,
      plan.snapshot,
      expect.any(Object),
      true,
    );

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
    expect(updateExperimentDashboardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        experiment,
        mainSnapshot: plan.snapshot,
        metricMap,
        factTableMap,
      }),
    );
  });

  it("does not refresh dashboards for manual dashboard snapshots", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan({
      snapshot: {
        ...makePlan().snapshot,
        triggeredBy: "manual-dashboard",
      },
    });

    await createSnapshotFromPlan({
      plan,
      context,
      experiment,
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(updateExperimentDashboardsMock).not.toHaveBeenCalled();
  });

  it("passes fullRefresh to the incremental runner for standard snapshots", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan({
      runnerKind: "incremental",
      fullRefresh: true,
    });

    await createSnapshotFromPlan({
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

    await createSnapshotFromPlan({
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
    expect(updateExperimentDashboardsMock).not.toHaveBeenCalled();
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

    await createSnapshotFromPlan({
      plan,
      context,
      experiment,
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
    });

    expect(updateExperimentMock).not.toHaveBeenCalled();
    expect(resultsQueryRunnerMock).toHaveBeenCalled();
  });

  describe("incremental refresh lock", () => {
    it("acquires lock before starting incremental snapshot", async () => {
      const context = makeContext();
      const experiment = makeExperiment();
      const plan = makePlan({ runnerKind: "incremental" });

      await createSnapshotFromPlan({
        plan,
        context,
        experiment,
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      });

      expect(
        context.models.incrementalRefresh.acquireLock,
      ).toHaveBeenCalledWith(experiment.id, plan.snapshot.id);
      expect(incrementalQueryRunnerMock).toHaveBeenCalled();
    });

    it("throws ConcurrentIncrementalRefreshError when lock cannot be acquired", async () => {
      const context = makeContext();
      (
        context.models.incrementalRefresh.acquireLock as jest.Mock
      ).mockResolvedValue(false);
      const experiment = makeExperiment();
      const plan = makePlan({ runnerKind: "incremental" });

      await expect(
        createSnapshotFromPlan({
          plan,
          context,
          experiment,
          metricMap: new Map<string, ExperimentMetricInterface>(),
          factTableMap: new Map() as FactTableMap,
        }),
      ).rejects.toThrow(ConcurrentIncrementalRefreshError);

      expect(incrementalQueryRunnerMock).not.toHaveBeenCalled();
      expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
    });

    it("releases lock when snapshot creation fails", async () => {
      const context = makeContext();
      const experiment = makeExperiment();
      const plan = makePlan({ runnerKind: "incremental" });

      // Make snapshot creation throw
      createExperimentSnapshotModelMock.mockRejectedValueOnce(
        new Error("DB write failed"),
      );

      await expect(
        createSnapshotFromPlan({
          plan,
          context,
          experiment,
          metricMap: new Map<string, ExperimentMetricInterface>(),
          factTableMap: new Map() as FactTableMap,
        }),
      ).rejects.toThrow("DB write failed");

      expect(
        context.models.incrementalRefresh.releaseLock,
      ).toHaveBeenCalledWith(experiment.id, plan.snapshot.id);
    });

    it("does not acquire lock for non-incremental plans", async () => {
      const context = makeContext();
      const experiment = makeExperiment();
      const plan = makePlan({ runnerKind: "results" });

      await createSnapshotFromPlan({
        plan,
        context,
        experiment,
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      });

      expect(
        context.models.incrementalRefresh.acquireLock,
      ).not.toHaveBeenCalled();
      expect(resultsQueryRunnerMock).toHaveBeenCalled();
    });

    it("does not release lock on failure for non-incremental plans", async () => {
      const context = makeContext();
      const experiment = makeExperiment();
      const plan = makePlan({ runnerKind: "results" });

      createExperimentSnapshotModelMock.mockRejectedValueOnce(
        new Error("DB write failed"),
      );

      await expect(
        createSnapshotFromPlan({
          plan,
          context,
          experiment,
          metricMap: new Map<string, ExperimentMetricInterface>(),
          factTableMap: new Map() as FactTableMap,
        }),
      ).rejects.toThrow("DB write failed");

      expect(
        context.models.incrementalRefresh.releaseLock,
      ).not.toHaveBeenCalled();
    });
  });
});
