import { QueryInterface, QueryStatus, Queries } from "shared/types/query";
import { ReqContext } from "back-end/types/request";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { AggregatedFactTableQueryRunner } from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";
import { getQueriesByIds } from "back-end/src/models/QueryModel";

jest.mock("back-end/src/models/QueryModel");

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
