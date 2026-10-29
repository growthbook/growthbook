import {
  isSupersededRefreshError,
  LOCK_LOST_ERROR,
  NOT_RUN_QUERY_ERROR,
  RESULTS_SUPERSEDED_ERROR,
  stopIncrementalRefresh,
} from "back-end/src/jobs/interruptedRefresh";
import {
  failQueuedQueries,
  getQueryStatusesByIds,
} from "back-end/src/models/QueryModel";
import { ConcurrentIncrementalRefreshError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";

jest.mock("back-end/src/models/QueryModel", () => ({
  failQueuedQueries: jest.fn(),
  getQueryStatusesByIds: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

describe("stopIncrementalRefresh", () => {
  const releaseLock = jest.fn();
  const context = {
    org: { id: "org_1" },
    models: { incrementalRefresh: { releaseLock } },
  } as unknown as ApiReqContext;
  const snapshot = {
    id: "snp_1",
    experiment: "exp_1",
    organization: "org_1",
    queries: [
      { name: "insert", query: "q_running", status: "running" as const },
      { name: "statistics", query: "q_queued", status: "queued" as const },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    releaseLock.mockResolvedValue(undefined);
    jest.mocked(getQueryStatusesByIds).mockResolvedValue([
      { id: "q_running", status: "running", createdAt: new Date() },
      { id: "q_queued", status: "queued", createdAt: new Date() },
    ]);
    jest.mocked(failQueuedQueries).mockImplementation(async (_, ids) => ids);
  });

  it("fails the queries that have not started, then releases the lock", async () => {
    await expect(stopIncrementalRefresh(context, snapshot)).resolves.toEqual([
      "q_queued",
    ]);
    expect(failQueuedQueries).toHaveBeenCalledWith(
      context,
      ["q_queued"],
      NOT_RUN_QUERY_ERROR,
    );
    expect(
      jest.mocked(failQueuedQueries).mock.invocationCallOrder[0],
    ).toBeLessThan(releaseLock.mock.invocationCallOrder[0]);
    expect(releaseLock).toHaveBeenCalledWith("exp_1", "snp_1");
  });

  it("still releases the lock when the queries can't be read", async () => {
    jest
      .mocked(getQueryStatusesByIds)
      .mockRejectedValue(new Error("mongo down"));
    await expect(stopIncrementalRefresh(context, snapshot)).resolves.toEqual(
      [],
    );
    expect(releaseLock).toHaveBeenCalledWith("exp_1", "snp_1");
  });
});

describe("isSupersededRefreshError", () => {
  it.each([
    new ConcurrentIncrementalRefreshError("busy"),
    RESULTS_SUPERSEDED_ERROR,
    new Error(RESULTS_SUPERSEDED_ERROR),
    new Error(`Query failed: ${LOCK_LOST_ERROR}`),
  ])("treats %p as another update taking over", (error) => {
    expect(isSupersededRefreshError(error)).toBe(true);
  });

  it.each([new Error("syntax error"), "warehouse unavailable", undefined])(
    "treats %p as an ordinary failure",
    (error) => {
      expect(isSupersededRefreshError(error)).toBe(false);
    },
  );
});
