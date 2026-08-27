import {
  QueryInterface,
  QueryPointer,
  QueryStatus,
  Queries,
} from "shared/types/query";
import { ReqContext } from "back-end/types/request";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  AggregatedFactTableQueryRunner,
  getRestateChunkBounds,
} from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";
import {
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "back-end/src/queryRunners/QueryRunner";
import { getQueriesByIds } from "back-end/src/models/QueryModel";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

jest.mock("back-end/src/models/QueryModel");

describe("getRestateChunkBounds", () => {
  it("slices a 14-day window into 7 sequential 2-day chunks", () => {
    const now = new Date("2024-01-15T00:00:00Z");
    const windowStart = new Date("2024-01-01T00:00:00Z");
    const chunks = getRestateChunkBounds(windowStart, now, 2);

    expect(chunks.length).toBe(7);

    // Chunks tile the window: each end === next start, half-open, no overlap.
    expect(chunks[0].start).toEqual(windowStart);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toEqual(chunks[i - 1].end);
    }
    // Each closed chunk is exactly chunkDays wide.
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].end!.getTime() - chunks[i].start.getTime()).toBe(
        2 * 24 * 60 * 60 * 1000,
      );
    }
    // Final chunk is open-ended so events arriving between planning and
    // execution aren't dropped.
    expect(chunks[6].end).toBeNull();
    expect(chunks[6].start).toEqual(new Date("2024-01-13T00:00:00Z"));
  });

  it("leaves the final chunk open when the window doesn't divide evenly", () => {
    const now = new Date("2024-01-15T12:00:00Z");
    const windowStart = new Date("2024-01-01T00:00:00Z");
    const chunks = getRestateChunkBounds(windowStart, now, 3);
    expect(chunks.length).toBe(5);
    expect(chunks[4].start).toEqual(new Date("2024-01-13T00:00:00Z"));
    expect(chunks[4].end).toBeNull();
  });

  it("emits at least one open chunk for degenerate windows", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const chunks = getRestateChunkBounds(now, now, 2);
    expect(chunks.length).toBe(1);
    expect(chunks[0].end).toBeNull();
  });

  it("snaps internal seams to UTC midnight so a mid-day window never splits a day", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const windowStart = new Date("2024-01-01T14:37:22Z");
    const now = new Date("2024-01-15T14:37:22Z");
    const chunks = getRestateChunkBounds(windowStart, now, 2);

    // First chunk keeps the exact window lower bound (a partial leading day).
    expect(chunks[0].start).toEqual(windowStart);

    for (let i = 0; i < chunks.length - 1; i++) {
      // Internal seam lands on a UTC day boundary, so no event_date
      // (= DATE(timestamp), UTC) can straddle two chunks.
      expect(chunks[i].end!.getTime() % DAY).toBe(0);
      // Contiguous: each end === next start, no gap/overlap.
      expect(chunks[i + 1].start).toEqual(chunks[i].end);
    }

    // Interior chunks (everything but the short leading and open trailing one)
    // are exactly chunkDays wide.
    for (let i = 1; i < chunks.length - 1; i++) {
      expect(chunks[i].end!.getTime() - chunks[i].start.getTime()).toBe(
        2 * DAY,
      );
    }

    expect(chunks[chunks.length - 1].end).toBeNull();
  });
});

const createMockQuery = (
  id: string,
  status: QueryStatus,
  error?: string,
): QueryInterface => ({
  id,
  organization: "test-org",
  datasource: "test-ds",
  language: "sql",
  query: "SELECT 1",
  status,
  dependencies: [],
  createdAt: new Date(),
  heartbeat: new Date(),
  queryType: "",
  ...(error ? { error } : {}),
});

const buildContext = () => {
  const updateByKeyIfCurrentExecution = jest.fn().mockResolvedValue(true);
  const updateRunFields = jest.fn().mockResolvedValue(undefined);
  const releaseLock = jest.fn().mockResolvedValue(undefined);
  const context = {
    org: { id: "test-org" },
    permissions: { canRunExperimentQueries: () => true },
    logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
    models: {
      aggregatedFactTableRuns: { updateRunFields },
      aggregatedFactTables: { updateByKeyIfCurrentExecution, releaseLock },
    },
  } as unknown as ReqContext;
  return { context, updateByKeyIfCurrentExecution, updateRunFields };
};

const integration = {
  datasource: { id: "test-ds", type: "postgres", settings: {} },
  context: { org: { id: "test-org" } },
} as unknown as SourceIntegrationInterface;

// Sets the private `params` the runner would normally capture in startQueries,
// so the terminal-failure branch of updateModel runs without a full warehouse
// round-trip.
class TestableRunner extends AggregatedFactTableQueryRunner {
  public primeParams(executionId: string) {
    // @ts-expect-error assigning the private field for the test
    this.params = {
      executionId,
      aggregatedFactTable: { currentExecutionId: executionId },
    };
  }
}

describe("AggregatedFactTableQueryRunner error surfacing", () => {
  afterEach(() => jest.clearAllMocks());

  // The reported bug: an invalid-SQL INSERT failure left the registry
  // `lastError` null, so the UI/API showed no error. The insert fails first,
  // then the dependent coverage query cascades to failed a refresh later.
  // Under the any-failure status policy the run stays running until the
  // cascade lands, and the terminal write must carry the real INSERT error.
  it("persists the real INSERT error to the registry and never clobbers it with null", async () => {
    const { context, updateByKeyIfCurrentExecution, updateRunFields } =
      buildContext();
    const queries: Queries = [
      {
        name: "insert_aggregated_fact_table_data",
        query: "qry_insert",
        status: "running",
      },
      {
        name: "aggregated_fact_table_max_timestamp",
        query: "qry_coverage",
        status: "queued",
      },
    ];
    const model = {
      id: "aftr_1",
      organization: "test-org",
      datasourceId: "test-ds",
      factTableId: "ft_1",
      idType: "user_id",
      queries,
      runStarted: new Date(),
    };

    const runner = new TestableRunner(
      context,
      model as never,
      integration,
      false,
    );
    runner.primeParams("aftexec_1");

    const insertFailed = createMockQuery(
      "qry_insert",
      "failed",
      "Syntax error: unexpected keyword INSERT at [1:1]",
    );

    (getQueriesByIds as jest.Mock).mockResolvedValue([
      insertFailed,
      createMockQuery("qry_coverage", "queued"),
    ]);
    await runner.refreshQueryStatuses();

    // Not terminal yet: the dependent coverage query is still queued, so no
    // registry write happens until the cascade marks it failed.
    expect(updateByKeyIfCurrentExecution).not.toHaveBeenCalled();

    (getQueriesByIds as jest.Mock).mockResolvedValue([
      insertFailed,
      createMockQuery(
        "qry_coverage",
        "failed",
        "Dependencies failed: qry_insert",
      ),
    ]);
    await runner.refreshQueryStatuses();

    expect(updateByKeyIfCurrentExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        datasourceId: "test-ds",
        factTableId: "ft_1",
        idType: "user_id",
      }),
      "aftexec_1",
      expect.objectContaining({
        lastError: expect.stringContaining("unexpected keyword INSERT"),
      }),
    );
    expect(updateRunFields).toHaveBeenLastCalledWith(
      "aftr_1",
      expect.objectContaining({
        error: expect.stringContaining("unexpected keyword INSERT"),
      }),
    );

    const registryLastErrors = updateByKeyIfCurrentExecution.mock.calls.map(
      (c) => c[2].lastError,
    );
    expect(registryLastErrors).not.toContain(null);
  });

  it("fails a restate run when only the coverage query fails", async () => {
    const { context, updateRunFields } = buildContext();
    const queries: Queries = [
      {
        name: "drop_aggregated_fact_table",
        query: "qry_drop",
        status: "succeeded",
      },
      {
        name: "create_aggregated_fact_table",
        query: "qry_create",
        status: "succeeded",
      },
      {
        name: "insert_aggregated_fact_table_data",
        query: "qry_insert",
        status: "succeeded",
      },
      {
        name: "aggregated_fact_table_max_timestamp",
        query: "qry_coverage",
        status: "running",
      },
    ];
    const model = {
      id: "aftr_1",
      organization: "test-org",
      datasourceId: "test-ds",
      factTableId: "ft_1",
      idType: "user_id",
      queries,
      runStarted: new Date(),
    };

    const runner = new TestableRunner(
      context,
      model as never,
      integration,
      false,
    );
    runner.primeParams("aftexec_1");

    (getQueriesByIds as jest.Mock).mockResolvedValue([
      createMockQuery("qry_drop", "succeeded"),
      createMockQuery("qry_create", "succeeded"),
      createMockQuery("qry_insert", "succeeded"),
      createMockQuery(
        "qry_coverage",
        "failed",
        "Syntax error: invalid column max_timestamp",
      ),
    ]);
    await runner.refreshQueryStatuses();

    expect(updateRunFields).toHaveBeenCalledWith(
      "aftr_1",
      expect.objectContaining({
        error: expect.stringContaining("invalid column max_timestamp"),
      }),
    );
    for (const [, payload] of updateRunFields.mock.calls) {
      expect(payload.result).toBeUndefined();
    }
  });
});

// The insert window must never run past the run's own clock: the scan's
// MAX(timestamp) becomes the registry watermark, and a future-stamped row
// would stall every later incremental append until the wall clock caught up.
describe("AggregatedFactTableQueryRunner scan window", () => {
  const NOW = new Date("2024-01-15T06:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // Captures the queries the runner would start instead of persisting them.
  class CapturingRunner extends AggregatedFactTableQueryRunner {
    public override async startQuery<
      Rows extends RowsType,
      ProcessedRows extends ProcessedRowsType,
    >(params: StartQueryParams<Rows, ProcessedRows>): Promise<QueryPointer> {
      return {
        name: params.name,
        query: `qry_${params.name}`,
        status: "running",
      };
    }
  }

  const buildRunner = (
    factTable: ReturnType<typeof factTableFactory.build>,
  ) => {
    const { context } = buildContext();
    const getInsertAggregatedFactTableDataQuery = jest
      .fn()
      .mockReturnValue("INSERT");
    const integration = {
      datasource: { id: "test-ds", type: "bigquery", settings: {} },
      context: { org: { id: "test-org" } },
      generateTablePath: () => "`proj.ds.gb_aggregated_ft_1_user_id`",
      getDropAggregatedFactTableQuery: () => "DROP",
      getCreateAggregatedFactTableQuery: () => "CREATE",
      getInsertAggregatedFactTableDataQuery,
      getAggregatedFactTableMaxTimestampQuery: () => "SELECT MAX",
      runIncrementalWithNoOutputQuery: jest.fn(),
    } as unknown as SourceIntegrationInterface;
    const model = {
      id: "aftr_1",
      organization: "test-org",
      datasourceId: "test-ds",
      factTableId: factTable.id,
      idType: "user_id",
      queries: [],
      runStarted: new Date(),
    };
    const runner = new CapturingRunner(
      context,
      model as never,
      integration,
      false,
    );
    return { runner, getInsertAggregatedFactTableDataQuery };
  };

  const metric = factMetricFactory.build({
    id: "fact_1",
    numerator: { factTableId: "ft_1", column: "value", aggregation: "sum" },
  });

  const baseParams = (
    factTable: ReturnType<typeof factTableFactory.build>,
  ) => ({
    factTable,
    idType: "user_id",
    metrics: [metric],
    executionId: "aftexec_1",
    factTableSettingsHash: "hash",
    metricState: [],
    lookbackWindowDays: 14,
  });

  it("bounds an incremental append at the run's start time", async () => {
    const factTable = factTableFactory.build({
      id: "ft_1",
      userIdTypes: ["user_id"],
    });
    const { runner, getInsertAggregatedFactTableDataQuery } =
      buildRunner(factTable);
    const lastMaxTimestamp = new Date("2024-01-14T23:00:00Z");

    await runner.startQueries({
      ...baseParams(factTable),
      mode: "incremental",
      aggregatedFactTable: {
        tableFullName: "`proj.ds.gb_aggregated_ft_1_user_id`",
        lastMaxTimestamp,
        currentExecutionId: "aftexec_1",
        inFlightExecutionId: null,
      } as never,
    });

    expect(getInsertAggregatedFactTableDataQuery).toHaveBeenCalledTimes(1);
    expect(getInsertAggregatedFactTableDataQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStartDate: lastMaxTimestamp,
        exclusiveStart: true,
        windowEndDate: NOW,
      }),
    );
  });

  it("closes an unchunked restate at the run's start time", async () => {
    const factTable = factTableFactory.build({
      id: "ft_1",
      userIdTypes: ["user_id"],
    });
    const { runner, getInsertAggregatedFactTableDataQuery } =
      buildRunner(factTable);

    await runner.startQueries({
      ...baseParams(factTable),
      mode: "restate",
      aggregatedFactTable: {
        tableFullName: null,
        lastMaxTimestamp: null,
        currentExecutionId: "aftexec_1",
        inFlightExecutionId: null,
      } as never,
    });

    expect(getInsertAggregatedFactTableDataQuery).toHaveBeenCalledTimes(1);
    expect(getInsertAggregatedFactTableDataQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStartDate: new Date(NOW.getTime() - 14 * DAY),
        exclusiveStart: false,
        windowEndDate: NOW,
      }),
    );
  });

  it("closes only the final chunk of a chunked restate at the run's start time", async () => {
    const factTable = factTableFactory.build({
      id: "ft_1",
      userIdTypes: ["user_id"],
      aggregatedFactTableSettings: {
        idTypes: ["user_id"],
        updateTime: { time: "02:00", timezone: "UTC" },
        lookbackWindow: 14,
        restateChunkDays: 7,
      },
    });
    const { runner, getInsertAggregatedFactTableDataQuery } =
      buildRunner(factTable);

    await runner.startQueries({
      ...baseParams(factTable),
      mode: "restate",
      aggregatedFactTable: {
        tableFullName: null,
        lastMaxTimestamp: null,
        currentExecutionId: "aftexec_1",
        inFlightExecutionId: null,
      } as never,
    });

    const chunks = getRestateChunkBounds(
      new Date(NOW.getTime() - 14 * DAY),
      NOW,
      7,
    );
    expect(chunks.length).toBeGreaterThan(1);
    const calls = getInsertAggregatedFactTableDataQuery.mock.calls.map(
      (c) => c[0],
    );
    expect(calls).toHaveLength(chunks.length);
    chunks.forEach((chunk, i) => {
      expect(calls[i].windowStartDate).toEqual(chunk.start);
      expect(calls[i].windowEndDate).toEqual(chunk.end ?? NOW);
    });
    // Interior seams are untouched; only the open final chunk is closed.
    expect(calls[0].windowEndDate).toEqual(chunks[0].end);
    expect(calls[0].windowEndDate).not.toEqual(NOW);
    expect(calls[calls.length - 1].windowEndDate).toEqual(NOW);
  });
});
