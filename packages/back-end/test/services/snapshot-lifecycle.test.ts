import { ExperimentMetricInterface } from "shared/experiments";
import { DataSourceInterface } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { ExperimentInterface } from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotQueryRunnerKind,
} from "shared/types/experiment-snapshot";
import { buildAnalysisKey } from "shared/snapshot-analysis-chunks";
import { MetricSnapshotSettings } from "shared/types/report";
import { ApiReqContext } from "back-end/types/api";
import {
  createSnapshotFromPlan,
  PlannedExperimentSnapshot,
} from "back-end/src/services/experiments";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import {
  createExperimentSnapshotModel,
  deleteQueuedSnapshots,
  hasQueuedSnapshot,
  startQueuedSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import { interruptIncrementalReaders } from "back-end/src/services/snapshotCancellation";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { resolvePrecomputedUnitDimensions } from "back-end/src/services/dimensions";
import {
  ConcurrentIncrementalRefreshError,
  QueuedSnapshotSupersededError,
} from "back-end/src/util/errors";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  createExperimentSnapshotModel: jest.fn(),
  deleteQueuedSnapshots: jest.fn(),
  hasQueuedSnapshot: jest.fn(),
  startQueuedSnapshot: jest.fn(),
  updateSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/services/dimensions", () => ({
  ...jest.requireActual("back-end/src/services/dimensions"),
  resolvePrecomputedUnitDimensions: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock("back-end/src/enterprise/services/dashboards", () => ({
  updateExperimentDashboards: jest.fn(),
}));

jest.mock("back-end/src/services/snapshotCancellation", () => ({
  interruptIncrementalReaders: jest.fn(),
}));

jest.mock("back-end/src/queryRunners/ExperimentResultsQueryRunner", () => ({
  ExperimentResultsQueryRunner: jest
    .fn()
    .mockImplementation((_context, snapshot) => ({
      model: snapshot,
      startAnalysis: jest.fn(),
      setExperimentUpdateExecutionLogger: jest.fn(),
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
        setExperimentUpdateExecutionLogger: jest.fn(),
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
        setExperimentUpdateExecutionLogger: jest.fn(),
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
const deleteQueuedSnapshotsMock = deleteQueuedSnapshots as jest.MockedFunction<
  typeof deleteQueuedSnapshots
>;
const hasQueuedSnapshotMock = hasQueuedSnapshot as jest.MockedFunction<
  typeof hasQueuedSnapshot
>;
const startQueuedSnapshotMock = startQueuedSnapshot as jest.MockedFunction<
  typeof startQueuedSnapshot
>;
const resolvePrecomputedUnitDimensionsMock =
  resolvePrecomputedUnitDimensions as jest.MockedFunction<
    typeof resolvePrecomputedUnitDimensions
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

const interruptIncrementalReadersMock =
  interruptIncrementalReaders as jest.MockedFunction<
    typeof interruptIncrementalReaders
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
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    models: {
      metricGroups: {
        getAll: jest.fn().mockResolvedValue([]),
      },
      incrementalRefresh: {
        acquireLock: jest.fn().mockResolvedValue(true),
        acquireReaderLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
        getByExperimentIdAndPhase: jest.fn().mockResolvedValue(null),
        getLegacyByExperimentIdWithoutPhase: jest.fn().mockResolvedValue(null),
      },
      dags: {
        create: jest.fn().mockResolvedValue(undefined),
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

type MakePlanOverrides = Omit<
  Partial<PlannedExperimentSnapshot>,
  "snapshot"
> & {
  runnerKind?: SnapshotQueryRunnerKind;
  snapshot?: Partial<PlannedExperimentSnapshot["snapshot"]>;
};

function makePlan({
  runnerKind = "results",
  snapshot: snapshotOverrides,
  ...overrides
}: MakePlanOverrides = {}): PlannedExperimentSnapshot {
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
          analysisKey: buildAnalysisKey(),
          dateCreated: new Date("2025-02-01T00:00:00.000Z"),
          results: [],
          settings: defaultAnalysisSettings,
          status: "running",
        },
      ],
      status: "running",
      ...snapshotOverrides,
      runnerKind,
    },
    useCache: true,
    fullRefresh: false,
    settingsForSnapshotMetrics: [] as MetricSnapshotSettings[],
    incrementalFallbackReason: null,
    fullRefreshReason: null,
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
    hasQueuedSnapshotMock.mockResolvedValue(false);
    resolvePrecomputedUnitDimensionsMock.mockImplementation(
      async ({ dimensionIds }) => ({
        dimensions: dimensionIds.map((id) => ({ id }) as DimensionInterface),
        skipped: [],
      }),
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
    expect(queryRunner.setExperimentUpdateExecutionLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({ runnerKind: "results" }),
      }),
    );
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

  it.each([
    ["incremental-full", false, true],
    ["incremental-update", true, false],
  ] as const)(
    "uses the shared incremental runner for %s and derives fullRefresh from the kind",
    async (runnerKind, plannedFullRefresh, expectedFullRefresh) => {
      const context = makeContext();
      const experiment = makeExperiment();
      const plan = makePlan({
        runnerKind,
        fullRefresh: plannedFullRefresh,
      });

      await createSnapshotFromPlan({
        plan,
        context,
        experiment,
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      });

      expect(incrementalQueryRunnerMock).toHaveBeenCalledWith(
        context,
        plan.snapshot,
        expect.any(Object),
        false,
      );
      const queryRunner = incrementalQueryRunnerMock.mock.results[0].value;
      expect(queryRunner.startAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          experimentId: experiment.id,
          fullRefresh: expectedFullRefresh,
          snapshotType: "standard",
        }),
      );
    },
  );

  it("uses the exploratory incremental runner for exploratory snapshots", async () => {
    const context = makeContext();
    const experiment = makeExperiment();
    const plan = makePlan({
      runnerKind: "incremental-exploratory",
      snapshot: {
        ...makePlan().snapshot,
        type: "exploratory",
        dimension: "country",
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
    it.each(["incremental-full", "incremental-update"] as const)(
      "acquires the lock as the writer and interrupts readers before starting a %s snapshot",
      async (runnerKind) => {
        const context = makeContext();
        const experiment = makeExperiment();
        const plan = makePlan({ runnerKind });

        await createSnapshotFromPlan({
          plan,
          context,
          experiment,
          metricMap: new Map<string, ExperimentMetricInterface>(),
          factTableMap: new Map() as FactTableMap,
        });

        expect(
          context.models.incrementalRefresh.acquireLock,
        ).toHaveBeenCalledWith({
          experimentId: experiment.id,
          phase: plan.snapshot.phase,
          snapshotId: plan.snapshot.id,
          legacyExperimentSettingsHash: expect.any(String),
        });
        expect(interruptIncrementalReadersMock).toHaveBeenCalledWith(
          context,
          experiment.id,
          plan.snapshot.id,
        );
        expect(
          interruptIncrementalReadersMock.mock.invocationCallOrder[0],
        ).toBeLessThan(incrementalQueryRunnerMock.mock.invocationCallOrder[0]);
      },
    );

    it("acquires the lock as a reader for an incremental-exploratory snapshot", async () => {
      const context = makeContext();
      const experiment = makeExperiment();
      const plan = makePlan({
        runnerKind: "incremental-exploratory",
        snapshot: { type: "exploratory", dimension: "country" },
      });

      await createSnapshotFromPlan({
        plan,
        context,
        experiment,
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      });

      expect(
        context.models.incrementalRefresh.acquireReaderLock,
      ).toHaveBeenCalledWith({
        experimentId: experiment.id,
        phase: plan.snapshot.phase,
        snapshotId: plan.snapshot.id,
        legacyExperimentSettingsHash: expect.any(String),
        request: { type: "dimension", dimension: "country" },
      });
      expect(
        context.models.incrementalRefresh.acquireLock,
      ).not.toHaveBeenCalled();
      expect(interruptIncrementalReadersMock).not.toHaveBeenCalled();
    });

    it("releases the writer lock and starts nothing when readers cannot be interrupted", async () => {
      const context = makeContext();
      const experiment = makeExperiment();
      const plan = makePlan({ runnerKind: "incremental-update" });
      interruptIncrementalReadersMock.mockRejectedValueOnce(
        new Error("Mongo unavailable"),
      );

      await expect(
        createSnapshotFromPlan({
          plan,
          context,
          experiment,
          metricMap: new Map<string, ExperimentMetricInterface>(),
          factTableMap: new Map() as FactTableMap,
        }),
      ).rejects.toThrow("Mongo unavailable");

      expect(
        context.models.incrementalRefresh.releaseLock,
      ).toHaveBeenCalledWith(experiment.id, plan.snapshot.id);
      expect(incrementalQueryRunnerMock).not.toHaveBeenCalled();
      expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
    });

    it("throws ConcurrentIncrementalRefreshError when lock cannot be acquired", async () => {
      const context = makeContext();
      (
        context.models.incrementalRefresh.acquireLock as jest.Mock
      ).mockResolvedValue(false);
      const experiment = makeExperiment();
      const plan = makePlan({ runnerKind: "incremental-update" });

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
      const plan = makePlan({ runnerKind: "incremental-full" });

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

    describe("queued breakdowns", () => {
      const args = (context: ApiReqContext) => ({
        context,
        experiment: makeExperiment({
          precomputedUnitDimensionIds: ["dim_a", "dim_a", "dim_b"],
        }),
        metricMap: new Map<string, ExperimentMetricInterface>(),
        factTableMap: new Map() as FactTableMap,
      });
      const queuedPlan = (sourceSnapshotId: string) =>
        makePlan({
          runnerKind: "incremental-exploratory",
          snapshot: {
            type: "exploratory",
            dimension: "dim_a",
            status: "queued",
            sourceSnapshotId,
          },
        });

      it("queues one breakdown per dimension and a DAG to start them", async () => {
        const context = makeContext();
        const plan = makePlan({ runnerKind: "incremental-update" });

        await createSnapshotFromPlan({ plan, ...args(context) });

        const created = createExperimentSnapshotModelMock.mock.calls.map(
          ([{ data }]) => data,
        );
        expect(created.map((s) => [s.dimension, s.status])).toEqual([
          [null, "running"],
          ["dim_a", "queued"],
          ["dim_b", "queued"],
        ]);
        expect(created[1]).toMatchObject({
          type: "exploratory",
          triggeredBy: "conditional",
          runnerKind: "incremental-exploratory",
          sourceSnapshotId: plan.snapshot.id,
          runStarted: null,
        });
        expect(context.models.dags.create).toHaveBeenCalledWith({
          status: "active",
          nodes: [
            expect.objectContaining({
              id: "main",
              targetId: plan.snapshot.id,
              dependsOn: [],
              maxAttempts: 1,
            }),
            expect.objectContaining({
              id: "dim_a",
              targetId: created[1].id,
              dependsOn: ["main"],
              maxAttempts: 3,
            }),
            expect.objectContaining({ id: "dim_b", targetId: created[2].id }),
          ],
        });
        // Only the Overall Results snapshot starts now
        expect(incrementalQueryRunnerMock).toHaveBeenCalledTimes(1);
        expect(exploratoryQueryRunnerMock).not.toHaveBeenCalled();
      });

      it("does not queue a dimension that was deleted or no longer fits", async () => {
        const context = makeContext();
        resolvePrecomputedUnitDimensionsMock.mockResolvedValue({
          dimensions: [{ id: "dim_b" } as DimensionInterface],
          skipped: [{ reason: "not-found", dimensionId: "dim_a" }],
        });

        await createSnapshotFromPlan({
          plan: makePlan({ runnerKind: "incremental-update" }),
          ...args(context),
        });

        expect(
          createExperimentSnapshotModelMock.mock.calls.map(
            ([{ data }]) => data.dimension,
          ),
        ).toEqual([null, "dim_b"]);
        expect(context.models.dags.create).toHaveBeenCalledWith({
          status: "active",
          nodes: [
            expect.objectContaining({ id: "main" }),
            expect.objectContaining({ id: "dim_b" }),
          ],
        });
      });

      it("still runs the Overall Results update when queueing fails, leaving nothing queued", async () => {
        const context = makeContext();
        (context.models.dags.create as jest.Mock).mockRejectedValue(
          new Error("Mongo unavailable"),
        );
        const plan = makePlan({ runnerKind: "incremental-update" });

        await createSnapshotFromPlan({ plan, ...args(context) });

        expect(deleteQueuedSnapshotsMock).toHaveBeenLastCalledWith(context, {
          experiment: "exp_123",
          phase: 0,
        });
        expect(incrementalQueryRunnerMock).toHaveBeenCalledTimes(1);
      });

      it("refuses a run of a breakdown that is already queued", async () => {
        const context = makeContext();
        hasQueuedSnapshotMock.mockResolvedValue(true);

        await expect(
          createSnapshotFromPlan({
            plan: makePlan({
              snapshot: { type: "exploratory", dimension: "dim_a" },
            }),
            ...args(context),
          }),
        ).rejects.toThrow(ConcurrentIncrementalRefreshError);

        expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
      });

      it("lets a dashboard run a breakdown that is already queued", async () => {
        const context = makeContext();
        hasQueuedSnapshotMock.mockResolvedValue(true);

        for (const triggeredBy of [
          "update-dashboards",
          "manual-dashboard",
        ] as const) {
          await createSnapshotFromPlan({
            plan: makePlan({
              snapshot: {
                type: "exploratory",
                dimension: "dim_a",
                triggeredBy,
              },
            }),
            ...args(context),
          });
        }

        expect(createExperimentSnapshotModelMock).toHaveBeenCalledTimes(2);
      });

      it("starts a queued breakdown in place when its source built the tables", async () => {
        const context = makeContext();
        (
          context.models.incrementalRefresh
            .getByExperimentIdAndPhase as jest.Mock
        ).mockResolvedValue({ materializedBySnapshotId: "snp_main" });
        const plan = queuedPlan("snp_main");
        startQueuedSnapshotMock.mockResolvedValue({
          ...plan.snapshot,
          status: "running",
        });
        // Its own queued state must not block it
        hasQueuedSnapshotMock.mockResolvedValue(true);

        await createSnapshotFromPlan({
          plan,
          startQueued: true,
          ...args(context),
        });

        expect(startQueuedSnapshotMock).toHaveBeenCalledWith(
          context,
          plan.snapshot.id,
        );
        expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
        expect(updateExperimentMock).not.toHaveBeenCalled();
        expect(exploratoryQueryRunnerMock).toHaveBeenCalledWith(
          context,
          expect.objectContaining({ id: plan.snapshot.id, status: "running" }),
          expect.any(Object),
          false,
        );
      });

      it("does not start a queued breakdown whose source did not build the tables", async () => {
        const context = makeContext();
        (
          context.models.incrementalRefresh
            .getByExperimentIdAndPhase as jest.Mock
        ).mockResolvedValue({ materializedBySnapshotId: "snp_newer" });
        const plan = queuedPlan("snp_main");

        await expect(
          createSnapshotFromPlan({
            plan,
            startQueued: true,
            ...args(context),
          }),
        ).rejects.toThrow(QueuedSnapshotSupersededError);

        expect(startQueuedSnapshotMock).not.toHaveBeenCalled();
        expect(exploratoryQueryRunnerMock).not.toHaveBeenCalled();
        expect(
          context.models.incrementalRefresh.releaseLock,
        ).toHaveBeenCalledWith("exp_123", plan.snapshot.id);
      });
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
