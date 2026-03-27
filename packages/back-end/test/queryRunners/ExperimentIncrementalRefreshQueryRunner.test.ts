import { ExperimentMetricInterface } from "shared/experiments";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { PartitionSettings } from "shared/types/integrations";
import {
  ExperimentIncrementalRefreshQueryRunner,
  ExperimentIncrementalRefreshQueryParams,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "back-end/src/queryRunners/QueryRunner";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { validateIncrementalPipeline } from "back-end/src/services/dataPipeline";
import { getExposureQueryEligibleDimensions } from "back-end/src/services/dimensions";
import { shouldRunHealthTrafficQuery } from "back-end/src/queryRunners/snapshotQueryHelpers";
import { ApiReqContext } from "back-end/types/api";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/services/dataPipeline", () => ({
  validateIncrementalPipeline: jest.fn(),
}));

jest.mock("back-end/src/services/dimensions", () => ({
  getExposureQueryEligibleDimensions: jest.fn(),
}));

jest.mock("back-end/src/queryRunners/snapshotQueryHelpers", () => ({
  shouldRunHealthTrafficQuery: jest.fn(),
}));

const getExperimentByIdMock = getExperimentById as jest.MockedFunction<
  typeof getExperimentById
>;
const validateIncrementalPipelineMock =
  validateIncrementalPipeline as jest.MockedFunction<
    typeof validateIncrementalPipeline
  >;
const getExposureQueryEligibleDimensionsMock =
  getExposureQueryEligibleDimensions as jest.MockedFunction<
    typeof getExposureQueryEligibleDimensions
  >;
const shouldRunHealthTrafficQueryMock =
  shouldRunHealthTrafficQuery as jest.MockedFunction<
    typeof shouldRunHealthTrafficQuery
  >;

type CapturedStartQuery = StartQueryParams<RowsType, ProcessedRowsType> & {
  id: string;
};

class TestExperimentIncrementalRefreshQueryRunner extends ExperimentIncrementalRefreshQueryRunner {
  startedQueries: CapturedStartQuery[] = [];
  private nextQueryId = 1;

  async startQuery<
    Rows extends RowsType,
    ProcessedRows extends ProcessedRowsType,
  >(params: StartQueryParams<Rows, ProcessedRows>) {
    const id = `query_${this.nextQueryId++}`;
    this.startedQueries.push({
      id,
      ...(params as unknown as StartQueryParams<RowsType, ProcessedRowsType>),
    });

    return {
      name: params.name,
      query: id,
      status: "queued" as const,
    };
  }
}

const partitionSettings: PartitionSettings = {
  type: "ingestYearMonthDay",
  yearColumn: "ingest_year",
  monthColumn: "ingest_month",
  dayColumn: "ingest_day",
};

function makeIntegration() {
  return {
    datasource: {
      id: "ds_123",
      type: "presto",
      settings: {
        queries: {
          exposure: [
            {
              id: "exp_query",
              query: "SELECT user_id, timestamp FROM exposures",
            },
          ],
        },
        pipelineSettings: {
          partitionSettings,
          writeDataset: "dataset",
          writeDatabase: "database",
        },
      },
    },
    context: {
      org: {
        id: "org_123",
      },
    },
    generateTablePath: jest.fn((tableName: string) => `database.${tableName}`),
    getSourceProperties: jest.fn(() => ({
      queryLanguage: "sql",
      maxColumns: 50,
    })),
    getDropOldIncrementalUnitsQuery: jest.fn(() => "drop units"),
    getCreateExperimentIncrementalUnitsQuery: jest.fn(() => "create units"),
    getUpdateExperimentIncrementalUnitsQuery: jest.fn(() => "update units"),
    getAlterNewIncrementalUnitsQuery: jest.fn(() => "alter units"),
    getMaxTimestampIncrementalUnitsQuery: jest.fn(() => "units max timestamp"),
    getCreateMetricSourceTableQuery: jest.fn(() => "create metrics source"),
    getInsertMetricSourceDataQuery: jest.fn(() => "insert metrics source"),
    getMaxTimestampMetricSourceQuery: jest.fn(
      () => "metrics source max timestamp",
    ),
    getIncrementalRefreshStatisticsQuery: jest.fn(() => "statistics"),
    getMaxIngestedPartitionSourceQuery: jest.fn(
      () => "source ingest partition",
    ),
    runDropTableQuery: jest.fn(),
    runIncrementalWithNoOutputQuery: jest.fn(),
    runMaxTimestampQuery: jest.fn(),
    runIncrementalRefreshStatisticsQuery: jest.fn(),
  } as unknown as SourceIntegrationInterface & {
    getMaxTimestampIncrementalUnitsQuery: jest.Mock;
    getMaxTimestampMetricSourceQuery: jest.Mock;
    getMaxIngestedPartitionSourceQuery: jest.Mock;
  };
}

function makeSnapshotSettings(metricId: string): ExperimentSnapshotSettings {
  return {
    dimensions: [],
    metricSettings: [{ id: metricId }],
    goalMetrics: [],
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
    attributionModel: "none",
    experimentId: "exp_123",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_123",
    exposureQueryId: "exp_query",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-01-31T00:00:00.000Z"),
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
  } as ExperimentSnapshotSettings;
}

function makeSnapshotModel(
  settings: ExperimentSnapshotSettings,
): ExperimentSnapshotInterface {
  return {
    id: "snapshot_123",
    organization: "org_123",
    experiment: "exp_123",
    phase: 0,
    dimension: null,
    dateCreated: new Date("2024-02-01T00:00:00.000Z"),
    runStarted: new Date("2024-02-01T00:00:00.000Z"),
    status: "running",
    settings,
    type: "standard",
    triggeredBy: "manual",
    queries: [],
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [],
  };
}

function makeContext() {
  return {
    org: {
      id: "org_123",
      settings: {
        runHealthTrafficQuery: false,
      },
    },
    permissions: {
      canRunExperimentQueries: () => true,
      throwPermissionError: () => {
        throw new Error("permission denied");
      },
    },
    logger: {
      warn: jest.fn(),
      error: jest.fn(),
    },
    models: {
      segments: {
        getById: jest.fn(),
      },
      incrementalRefresh: {
        getByExperimentId: jest.fn(),
        updateByExperimentIdIfCurrentExecution: jest
          .fn()
          .mockResolvedValue(true),
      },
    },
  } as unknown as ApiReqContext & {
    models: {
      incrementalRefresh: {
        getByExperimentId: jest.Mock;
        updateByExperimentIdIfCurrentExecution: jest.Mock;
      };
    };
  };
}

function makeParams(
  settings: ExperimentSnapshotSettings,
  metric: ExperimentMetricInterface,
  factTableId: string,
): ExperimentIncrementalRefreshQueryParams {
  return {
    snapshotType: "standard",
    snapshotSettings: settings,
    variationNames: ["Control", "Treatment"],
    metricMap: new Map([[metric.id, metric]]),
    factTableMap: new Map([
      [
        factTableId,
        factTableFactory.build({
          id: factTableId,
          sql: "SELECT user_id, timestamp, value FROM fact_events",
        }),
      ],
    ]),
    queryParentId: "parent_123",
    experimentId: "exp_123",
    experimentQueryMetadata: null,
    fullRefresh: false,
    incrementalRefreshStartTime: new Date("2024-02-01T00:00:00.000Z"),
  };
}

describe("ExperimentIncrementalRefreshQueryRunner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getExperimentByIdMock.mockResolvedValue({
      id: "exp_123",
      datasource: "ds_123",
      variations: [{ name: "Control" }, { name: "Treatment" }],
    } as never);
    validateIncrementalPipelineMock.mockResolvedValue(undefined);
    getExposureQueryEligibleDimensionsMock.mockReturnValue({
      eligibleDimensions: [],
      eligibleDimensionsWithSlices: [],
      eligibleDimensionsWithSlicesUnderMaxCells: [],
    });
    shouldRunHealthTrafficQueryMock.mockReturnValue(false);
  });

  it("uses table-derived ingest cursors for units and metric sources", async () => {
    const metric = factMetricFactory.build({
      id: "metric_123",
      numerator: {
        factTableId: "fact_table_123",
      },
    }) as ExperimentMetricInterface;
    const settings = makeSnapshotSettings(metric.id);
    const context = makeContext();
    context.models.incrementalRefresh.getByExperimentId.mockResolvedValue({
      unitsMaxTimestamp: new Date("2024-01-10T00:00:00.000Z"),
      unitsLastIngestedPartition: "2024-01-10",
      metricSources: [
        {
          groupId: "group_123",
          factTableId: "fact_table_123",
          metrics: [{ id: metric.id, settingsHash: "settings_hash" }],
          maxTimestamp: new Date("2024-01-11T00:00:00.000Z"),
          lastIngestedPartition: "2024-01-11",
          tableFullName: "database.metric_source_123",
        },
      ],
      metricCovariateSources: [],
    });

    const integration = makeIntegration();
    const runner = new TestExperimentIncrementalRefreshQueryRunner(
      context,
      makeSnapshotModel(settings),
      integration,
      false,
    );

    await runner.startQueries(makeParams(settings, metric, "fact_table_123"));

    expect(
      integration.getMaxIngestedPartitionSourceQuery,
    ).not.toHaveBeenCalled();
    expect(
      integration.getMaxTimestampIncrementalUnitsQuery,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        includeLastIngestedPartition: true,
        unitsTableFullName: "database.gb_units_exp_123",
      }),
    );
    expect(integration.getMaxTimestampMetricSourceQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        includeLastIngestedPartition: true,
        metricSourceTableFullName: "database.metric_source_123",
      }),
    );
    expect(
      runner.startedQueries.some((query) =>
        query.name.startsWith("max_ingested_partition_"),
      ),
    ).toBe(false);
  });

  it("persists ingest cursors from the table max timestamp results", async () => {
    const metric = factMetricFactory.build({
      id: "metric_123",
      numerator: {
        factTableId: "fact_table_123",
      },
    }) as ExperimentMetricInterface;
    const settings = makeSnapshotSettings(metric.id);
    const context = makeContext();
    context.models.incrementalRefresh.getByExperimentId.mockResolvedValue({
      unitsMaxTimestamp: new Date("2024-01-10T00:00:00.000Z"),
      unitsLastIngestedPartition: "2024-01-10",
      metricSources: [
        {
          groupId: "group_123",
          factTableId: "fact_table_123",
          metrics: [{ id: metric.id, settingsHash: "settings_hash" }],
          maxTimestamp: new Date("2024-01-11T00:00:00.000Z"),
          lastIngestedPartition: "2024-01-11",
          tableFullName: "database.metric_source_123",
        },
      ],
      metricCovariateSources: [],
    });

    const integration = makeIntegration();
    const runner = new TestExperimentIncrementalRefreshQueryRunner(
      context,
      makeSnapshotModel(settings),
      integration,
      false,
    );

    await runner.startQueries(makeParams(settings, metric, "fact_table_123"));

    const maxUnitsQuery = runner.startedQueries.find(
      (query) => query.name === "max_timestamp_parent_123",
    );
    const maxMetricSourceQuery = runner.startedQueries.find(
      (query) => query.name === "max_timestamp_metrics_source_group_123",
    );

    expect(maxUnitsQuery?.onSuccess).toBeDefined();
    expect(maxMetricSourceQuery?.onSuccess).toBeDefined();

    await maxUnitsQuery?.onSuccess?.([
      {
        max_timestamp: "2024-01-15T00:00:00.000Z",
        last_ingested_partition: "2024-01-15",
      },
    ]);
    await maxMetricSourceQuery?.onSuccess?.([
      {
        max_timestamp: "2024-01-16T00:00:00.000Z",
        last_ingested_partition: "2024-01-16",
      },
    ]);

    expect(
      context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution,
    ).toHaveBeenNthCalledWith(
      1,
      "exp_123",
      "parent_123",
      expect.objectContaining({
        unitsMaxTimestamp: new Date("2024-01-15T00:00:00.000Z"),
        unitsLastIngestedPartition: "2024-01-15",
      }),
    );
    expect(
      context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution,
    ).toHaveBeenNthCalledWith(
      2,
      "exp_123",
      "parent_123",
      expect.objectContaining({
        metricSources: [
          expect.objectContaining({
            groupId: "group_123",
            maxTimestamp: new Date("2024-01-16T00:00:00.000Z"),
            lastIngestedPartition: "2024-01-16",
          }),
        ],
      }),
    );
  });
});
