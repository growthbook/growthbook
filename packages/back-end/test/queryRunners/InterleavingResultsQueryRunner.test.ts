import { Queries } from "shared/types/query";
import {
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import { InterleavingResultsQueryRunner } from "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner";
import { ResolvedInterleavingMetric } from "back-end/src/enterprise/services/interleavingMetrics";
import { markPendingQueriesAsFailed } from "back-end/src/models/QueryModel";
import { cancelExternalJobsForQueries } from "back-end/src/services/queryCancellation";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ReqContext } from "back-end/types/api";

jest.mock("back-end/src/models/QueryModel", () => ({
  ...jest.requireActual("back-end/src/models/QueryModel"),
  markPendingQueriesAsFailed: jest.fn(),
}));
jest.mock("back-end/src/services/queryCancellation", () => ({
  ...jest.requireActual("back-end/src/services/queryCancellation"),
  cancelExternalJobsForQueries: jest.fn(),
}));

const mockMarkFailed = markPendingQueriesAsFailed as jest.MockedFunction<
  typeof markPendingQueriesAsFailed
>;
const mockCancelExternal = cancelExternalJobsForQueries as jest.MockedFunction<
  typeof cancelExternalJobsForQueries
>;

const settings = (): InterleavingSnapshotSettings => ({
  interleavingId: "il_1",
  trackingKey: "search-ranking",
  datasourceId: "ds_1",
  interleavingExposureQueryId: "ileq_1",
  exposureQuery: "SELECT 1",
  userIdType: "user_id",
  variations: [
    { id: "v0", key: "popular", name: "Popular" },
    { id: "v1", key: "buyers-pick", name: "Buyer's pick" },
  ],
  metrics: [],
  startDate: new Date("2026-10-01T00:00:00Z"),
  endDate: null,
});

// One metric per fact table, so startQueries makes two startQuery calls
const metricsOnTwoFactTables = () =>
  ["ft_a", "ft_b"].map(
    (id, i) =>
      ({
        config: { id: `fact__m${i}`, analyses: [{ type: "paired" }] },
        metric: { id: `fact__m${i}` },
        factTable: { id },
      }) as unknown as ResolvedInterleavingMetric,
  );

const makeIntegration = () =>
  ({
    datasource: { id: "ds_1", projects: [] },
    getInterleavingMetricQuery: () => "SELECT 1",
    runInterleavingMetricQuery: async () => ({ rows: [] }),
  }) as unknown as SourceIntegrationInterface;

const makeContext = () =>
  ({
    org: { id: "org_1" },
    permissions: { canRunExperimentQueries: () => true },
  }) as unknown as ReqContext;

const makeModel = () =>
  ({
    id: "ilsnp_1",
    organization: "org_1",
    interleavingId: "il_1",
    status: "running",
    queries: [],
    runStarted: null,
    frozenSettings: settings(),
  }) as unknown as InterleavingSnapshotInterface;

// Typed view over the inherited `startQuery` seam, so the test can fail one
// call without `any` casts (forbidden by the repo guide).
type RunnerTestInternals = {
  startQuery: (q: { name: string }) => Promise<{
    name: string;
    query: string;
    status: string;
  }>;
  startQueries: (p: {
    snapshotSettings: InterleavingSnapshotSettings;
    metrics: ResolvedInterleavingMetric[];
  }) => Promise<Queries>;
};

function newRunner() {
  const runner = new InterleavingResultsQueryRunner(
    makeContext(),
    makeModel(),
    makeIntegration(),
    false,
  );
  return {
    runner,
    internals: runner as unknown as RunnerTestInternals,
  };
}

describe("InterleavingResultsQueryRunner.startQueries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkFailed.mockResolvedValue(1);
    mockCancelExternal.mockResolvedValue(undefined);
  });

  it("cancels the queries it already started when a later one fails", async () => {
    const { internals } = newRunner();
    let call = 0;
    internals.startQuery = async ({ name }) => {
      call++;
      if (call > 1) throw new Error("could not register query");
      return { name, query: "qry_1", status: "running" };
    };

    await expect(
      internals.startQueries({
        snapshotSettings: settings(),
        metrics: metricsOnTwoFactTables(),
      }),
    ).rejects.toThrow("could not register query");

    // The Mongo fence has to land before the warehouse cancel
    expect(mockMarkFailed).toHaveBeenCalledWith(
      expect.anything(),
      ["qry_1"],
      expect.stringContaining("could not start all of its queries"),
    );
    expect(mockCancelExternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ["qry_1"],
      { modelId: "ilsnp_1" },
    );
    expect(mockMarkFailed.mock.invocationCallOrder[0]).toBeLessThan(
      mockCancelExternal.mock.invocationCallOrder[0],
    );
  });

  it("cancels nothing when the very first query fails", async () => {
    const { internals } = newRunner();
    internals.startQuery = async () => {
      throw new Error("could not register query");
    };

    await expect(
      internals.startQueries({
        snapshotSettings: settings(),
        metrics: metricsOnTwoFactTables(),
      }),
    ).rejects.toThrow("could not register query");

    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockCancelExternal).not.toHaveBeenCalled();
  });

  it("returns every pointer and cancels nothing on success", async () => {
    const { internals } = newRunner();
    let call = 0;
    internals.startQuery = async ({ name }) => {
      call++;
      return { name, query: `qry_${call}`, status: "running" };
    };

    const queries = await internals.startQueries({
      snapshotSettings: settings(),
      metrics: metricsOnTwoFactTables(),
    });

    expect(queries.map((q) => q.query)).toEqual(["qry_1", "qry_2"]);
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockCancelExternal).not.toHaveBeenCalled();
  });
});
