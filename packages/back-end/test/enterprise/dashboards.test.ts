import { DashboardInterface } from "shared/enterprise";
import { ExperimentInterface } from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { ApiReqContext } from "back-end/types/api";
import {
  getDataSourceById,
  getDataSourcesByIds,
} from "back-end/src/models/DataSourceModel";
import { findSnapshotsByIds } from "back-end/src/models/ExperimentSnapshotModel";
import {
  createSnapshot,
  getAdditionalExperimentAnalysisSettings,
  getDefaultExperimentAnalysisSettings,
  planExperimentSnapshot,
  rebuildOverallResultsForDimensionBreakdowns,
} from "back-end/src/services/experiments";
import { createMetricAnalysis } from "back-end/src/services/metric-analysis";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import { logger } from "back-end/src/util/logger";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";

jest.mock("shared/settings", () => ({
  getScopedSettings: jest.fn().mockReturnValue({
    settings: { pValueThreshold: { value: 0.05 } },
  }),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
  getDataSourcesByIds: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findSnapshotsByIds: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  createSnapshot: jest.fn(),
  determineNextDate: jest.fn(),
  getAdditionalExperimentAnalysisSettings: jest.fn(),
  getDefaultExperimentAnalysisSettings: jest.fn(),
  planExperimentSnapshot: jest.fn(),
  rebuildOverallResultsForDimensionBreakdowns: jest.fn(),
}));

jest.mock("back-end/src/services/metric-analysis", () => ({
  createMetricAnalysis: jest.fn(),
}));

jest.mock(
  "back-end/src/routers/saved-queries/saved-queries.controller",
  () => ({
    executeAndSaveQuery: jest.fn(),
  }),
);

jest.mock("back-end/src/enterprise/services/product-analytics", () => ({
  runProductAnalyticsExploration: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { warn: jest.fn() },
}));

const findSnapshotsByIdsMock = findSnapshotsByIds as jest.MockedFunction<
  typeof findSnapshotsByIds
>;
const getDataSourceByIdMock = getDataSourceById as jest.MockedFunction<
  typeof getDataSourceById
>;
const getDataSourcesByIdsMock = getDataSourcesByIds as jest.MockedFunction<
  typeof getDataSourcesByIds
>;
const createSnapshotMock = createSnapshot as jest.MockedFunction<
  typeof createSnapshot
>;
const getAdditionalExperimentAnalysisSettingsMock =
  getAdditionalExperimentAnalysisSettings as jest.MockedFunction<
    typeof getAdditionalExperimentAnalysisSettings
  >;
const getDefaultExperimentAnalysisSettingsMock =
  getDefaultExperimentAnalysisSettings as jest.MockedFunction<
    typeof getDefaultExperimentAnalysisSettings
  >;
const planExperimentSnapshotMock =
  planExperimentSnapshot as jest.MockedFunction<typeof planExperimentSnapshot>;
const rebuildOverallResultsForDimensionBreakdownsMock =
  rebuildOverallResultsForDimensionBreakdowns as jest.MockedFunction<
    typeof rebuildOverallResultsForDimensionBreakdowns
  >;
const createMetricAnalysisMock = createMetricAnalysis as jest.MockedFunction<
  typeof createMetricAnalysis
>;
const loggerWarnMock = logger.warn as jest.MockedFunction<typeof logger.warn>;

const defaultAnalysisSettings = {
  dimensions: [],
  differenceType: "relative",
  baselineVariationIndex: 0,
} as unknown as ExperimentSnapshotAnalysisSettings;

function makeDimensionBlock({
  id,
  dimensionId,
  snapshotId,
}: {
  id: string;
  dimensionId: string;
  snapshotId: string;
}): DashboardInterface["blocks"][number] {
  return {
    id,
    type: "experiment-dimension",
    experimentId: "exp_123",
    dimensionId,
    snapshotId,
    differenceType: "relative",
    baselineRow: 0,
  } as DashboardInterface["blocks"][number];
}

function makeMetricBlock(id: string): DashboardInterface["blocks"][number] {
  return {
    id,
    type: "metric-explorer",
    metricAnalysisId: `ma_${id}`,
    analysisSettings: {
      userIdType: "user_id",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-08-01T00:00:00.000Z"),
      lookbackDays: 30,
      populationType: "metric",
      populationId: null,
    },
  } as DashboardInterface["blocks"][number];
}

function makeDashboard({
  id,
  blocks,
}: {
  id: string;
  blocks: DashboardInterface["blocks"];
}): DashboardInterface {
  return { id, blocks } as DashboardInterface;
}

function makePreviousSnapshot({
  id,
  dimension,
}: {
  id: string;
  dimension: string;
}): ExperimentSnapshotInterface {
  return snapshotFactory.build({
    id,
    experiment: "exp_123",
    dimension,
    analyses: [
      {
        settings: defaultAnalysisSettings,
        status: "success",
      } as ExperimentSnapshotInterface["analyses"][number],
    ],
  });
}

type TestContext = ApiReqContext & {
  models: ApiReqContext["models"] & {
    dashboards: {
      findByExperiment: jest.Mock;
      dangerousUpdateBypassPermission: jest.Mock;
    };
    metricAnalysis: { getById: jest.Mock };
    savedQueries: { getByIds: jest.Mock };
  };
};

function makeContext(dashboards: DashboardInterface[]): TestContext {
  return {
    org: { id: "org_123", settings: {} },
    models: {
      dashboards: {
        findByExperiment: jest.fn().mockResolvedValue(dashboards),
        dangerousUpdateBypassPermission: jest.fn().mockResolvedValue(undefined),
      },
      projects: { getById: jest.fn().mockResolvedValue(null) },
      metricGroups: { getAll: jest.fn().mockResolvedValue([]) },
      metricAnalysis: {
        getById: jest.fn().mockImplementation(async (id: string) => ({
          id,
          metric: `fm_${id}`,
        })),
      },
      factMetrics: { getById: jest.fn().mockResolvedValue({ id: "fm_123" }) },
      savedQueries: { getByIds: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as TestContext;
}

const experiment = {
  id: "exp_123",
  organization: "org_123",
  datasource: "ds_123",
  project: "",
  phases: [{}],
} as unknown as ExperimentInterface;

const mainSnapshot = snapshotFactory.build({
  experiment: experiment.id,
  dimension: null,
  settings: {
    dimensions: [],
    precomputedUnitDimensionIds: [],
  } as unknown as ExperimentSnapshotInterface["settings"],
});

async function update(context: ApiReqContext): Promise<void> {
  await updateExperimentDashboards({
    context,
    experiment,
    mainSnapshot,
    statsEngine: "bayesian",
    regressionAdjustmentEnabled: false,
    postStratificationEnabled: false,
    settingsForSnapshotMetrics: [],
    metricMap: new Map(),
    factTableMap: new Map(),
  });
}

describe("updateExperimentDashboards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDataSourceByIdMock.mockResolvedValue({ id: "ds_123" } as never);
    getDataSourcesByIdsMock.mockResolvedValue([]);
    findSnapshotsByIdsMock.mockResolvedValue([]);
    getDefaultExperimentAnalysisSettingsMock.mockReturnValue(
      defaultAnalysisSettings,
    );
    getAdditionalExperimentAnalysisSettingsMock.mockReturnValue([]);
    planExperimentSnapshotMock.mockResolvedValue({
      overallResultsFullRefreshWouldUnblock: false,
    } as never);
    rebuildOverallResultsForDimensionBreakdownsMock.mockResolvedValue(
      undefined,
    );
    createSnapshotMock.mockResolvedValue({
      waitForResults: jest.fn().mockResolvedValue(undefined),
    } as never);
    createMetricAnalysisMock.mockResolvedValue({
      model: { id: "ma_refreshed" },
    } as never);
  });

  it("continues snapshot and dashboard work when the Overall Results probe fails", async () => {
    const dimensionBlock = makeDimensionBlock({
      id: "block_dimension",
      dimensionId: "exp:country",
      snapshotId: "snp_country",
    });
    const context = makeContext([
      makeDashboard({
        id: "dash_1",
        blocks: [dimensionBlock, makeMetricBlock("metric_1")],
      }),
    ]);
    findSnapshotsByIdsMock.mockResolvedValue([
      makePreviousSnapshot({
        id: "snp_country",
        dimension: "exp:country",
      }),
    ]);
    planExperimentSnapshotMock.mockRejectedValue(new Error("probe failed"));

    await update(context);

    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(context.models.savedQueries.getByIds).toHaveBeenCalled();
    expect(createMetricAnalysisMock).toHaveBeenCalledTimes(1);
    expect(
      context.models.dashboards.dangerousUpdateBypassPermission,
    ).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: experiment.id,
        dimensionId: "exp:country",
      }),
      expect.stringContaining("probe or rebuild"),
    );
  });

  it("continues later dimensions and dashboard work when one snapshot runner fails", async () => {
    const blocks = [
      makeDimensionBlock({
        id: "block_country",
        dimensionId: "exp:country",
        snapshotId: "snp_country",
      }),
      makeDimensionBlock({
        id: "block_browser",
        dimensionId: "exp:browser",
        snapshotId: "snp_browser",
      }),
      makeMetricBlock("metric_1"),
    ];
    const context = makeContext([makeDashboard({ id: "dash_1", blocks })]);
    findSnapshotsByIdsMock.mockResolvedValue([
      makePreviousSnapshot({
        id: "snp_country",
        dimension: "exp:country",
      }),
      makePreviousSnapshot({
        id: "snp_browser",
        dimension: "exp:browser",
      }),
    ]);
    const firstWaitForResults = jest
      .fn()
      .mockRejectedValue(new Error("runner failed"));
    const secondWaitForResults = jest.fn().mockResolvedValue(undefined);
    createSnapshotMock
      .mockResolvedValueOnce({ waitForResults: firstWaitForResults } as never)
      .mockResolvedValueOnce({ waitForResults: secondWaitForResults } as never);

    await update(context);

    expect(createSnapshotMock).toHaveBeenCalledTimes(2);
    expect(firstWaitForResults).toHaveBeenCalledTimes(1);
    expect(secondWaitForResults).toHaveBeenCalledTimes(1);
    expect(context.models.savedQueries.getByIds).toHaveBeenCalled();
    expect(createMetricAnalysisMock).toHaveBeenCalledTimes(1);
  });

  it("drops a stale block and refreshes the remaining block", async () => {
    const context = makeContext([
      makeDashboard({
        id: "dash_1",
        blocks: [
          makeDimensionBlock({
            id: "block_stale",
            dimensionId: "exp:country",
            snapshotId: "snp_missing",
          }),
          makeDimensionBlock({
            id: "block_valid",
            dimensionId: "exp:browser",
            snapshotId: "snp_browser",
          }),
        ],
      }),
    ]);
    findSnapshotsByIdsMock.mockResolvedValue([
      makePreviousSnapshot({
        id: "snp_browser",
        dimension: "exp:browser",
      }),
    ]);

    await update(context);

    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: experiment.id,
        blockId: "block_stale",
        snapshotId: "snp_missing",
      }),
      expect.stringContaining("missing snapshot"),
    );
  });

  it("continues dashboard tails after saved-query and dashboard failures", async () => {
    const context = makeContext([
      makeDashboard({ id: "dash_1", blocks: [makeMetricBlock("metric_1")] }),
      makeDashboard({ id: "dash_2", blocks: [makeMetricBlock("metric_2")] }),
    ]);
    context.models.savedQueries.getByIds.mockRejectedValue(
      new Error("saved queries failed"),
    );
    context.models.metricAnalysis.getById
      .mockRejectedValueOnce(new Error("dashboard failed"))
      .mockResolvedValueOnce({ id: "ma_metric_2", metric: "fm_metric_2" });

    await update(context);

    expect(context.models.metricAnalysis.getById).toHaveBeenCalledTimes(2);
    expect(createMetricAnalysisMock).toHaveBeenCalledTimes(1);
    expect(
      context.models.dashboards.dangerousUpdateBypassPermission,
    ).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: experiment.id,
        unit: "saved-query-batch",
      }),
      expect.stringContaining("saved query refresh failed"),
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: experiment.id,
        dashboardId: "dash_1",
      }),
      expect.stringContaining("dependent refresh failed"),
    );
  });
});
