import { QueryInterface } from "shared/types/query";
import {
  CANCEL_CONFIRMATION_DELAY_MS,
  cancelExternalJobsForQueries,
  cancelQueryAndConfirm,
} from "back-end/src/services/queryCancellation";
import {
  ExternalQueryStatus,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { getQueriesByIds } from "back-end/src/models/QueryModel";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/QueryModel", () => ({
  getQueriesByIds: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;

const logContext = { datasourceId: "ds_1", modelId: "mdl_1" };

type IntegrationStub = Pick<
  SourceIntegrationInterface,
  "cancelQuery" | "getExternalQueryStatus"
>;

function makeIntegration(stub: IntegrationStub): SourceIntegrationInterface {
  return stub as unknown as SourceIntegrationInterface;
}

// The confirmation probe runs inside a setTimeout callback, so the fake clock
// has to be advanced and the callback's own promise chain drained.
async function flushConfirmation() {
  jest.advanceTimersByTime(CANCEL_CONFIRMATION_DELAY_MS);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("cancelQueryAndConfirm", () => {
  it("does nothing when the integration cannot cancel", async () => {
    const integration = makeIntegration({});

    await cancelQueryAndConfirm(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });

  it("warns immediately when the warehouse rejects the cancel request", async () => {
    const getExternalQueryStatus = jest.fn();
    const integration = makeIntegration({
      cancelQuery: jest.fn().mockRejectedValue(new Error("boom")),
      getExternalQueryStatus,
    });

    await cancelQueryAndConfirm(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "q1", ...logContext }),
      expect.stringContaining("boom"),
    );
    expect(getExternalQueryStatus).not.toHaveBeenCalled();
  });

  it("skips confirmation when the integration cannot report status", async () => {
    const integration = makeIntegration({
      cancelQuery: jest.fn().mockResolvedValue(undefined),
    });

    await cancelQueryAndConfirm(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
  });

  it("warns after the delay when the query is still running", async () => {
    jest.useFakeTimers();
    try {
      const integration = makeIntegration({
        cancelQuery: jest.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: jest.fn().mockResolvedValue({
          state: "running",
        }),
      });

      await cancelQueryAndConfirm(
        integration,
        { externalId: "q1" },
        logContext,
      );
      expect(mockedLogger.warn).not.toHaveBeenCalled();

      await flushConfirmation();

      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: "q1",
          elapsedMs: CANCEL_CONFIRMATION_DELAY_MS,
          ...logContext,
        }),
        "External query still running after cancel request",
      );
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it.each<ExternalQueryStatus>([
    { state: "succeeded" },
    { state: "failed", error: "nope" },
  ])("does not warn when the query is %j", async (status) => {
    jest.useFakeTimers();
    try {
      const integration = makeIntegration({
        cancelQuery: jest.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: jest.fn().mockResolvedValue(status),
      });

      await cancelQueryAndConfirm(
        integration,
        { externalId: "q1" },
        logContext,
      );
      await flushConfirmation();

      expect(mockedLogger.warn).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("warns with the reason when the status is unknown", async () => {
    jest.useFakeTimers();
    try {
      const integration = makeIntegration({
        cancelQuery: jest.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: jest.fn().mockResolvedValue({
          state: "unknown",
          reason: "expired",
        }),
      });

      await cancelQueryAndConfirm(
        integration,
        { externalId: "q1" },
        logContext,
      );
      await flushConfirmation();

      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: "q1",
          reason: "expired",
          ...logContext,
        }),
        "Could not confirm external query cancellation",
      );
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("warns instead of rejecting when the confirmation probe throws", async () => {
    jest.useFakeTimers();
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const integration = makeIntegration({
        cancelQuery: jest.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: jest.fn().mockRejectedValue(new Error("down")),
      });

      await cancelQueryAndConfirm(
        integration,
        { externalId: "q1" },
        logContext,
      );
      await flushConfirmation();

      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: "q1", ...logContext }),
        expect.stringContaining("down"),
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe("cancelExternalJobsForQueries", () => {
  const context = { org: { id: "org_1" } } as unknown as ReqContext;
  const mockedGetQueriesByIds = jest.mocked(getQueriesByIds);

  function makeQuery(
    id: string,
    fields: Partial<QueryInterface> = {},
  ): QueryInterface {
    return {
      id,
      organization: "org_1",
      datasource: "ds_1",
      language: "sql",
      query: "SELECT 1",
      status: "failed",
      dependencies: [],
      createdAt: new Date(),
      heartbeat: new Date(),
      queryType: "",
      ...fields,
    };
  }

  function makeCancellingIntegration(
    cancelQuery: SourceIntegrationInterface["cancelQuery"],
  ): SourceIntegrationInterface {
    return {
      datasource: { id: "ds_1" },
      cancelQuery,
    } as unknown as SourceIntegrationInterface;
  }

  function stubQueryDocs(docs: QueryInterface[]) {
    mockedGetQueriesByIds.mockImplementation(async (_ctx, ids) =>
      docs.filter((d) => ids.includes(d.id)),
    );
  }

  it("does nothing for an empty id list", async () => {
    const cancelQuery = jest.fn().mockResolvedValue(undefined);

    await cancelExternalJobsForQueries(
      context,
      makeCancellingIntegration(cancelQuery),
      [],
      { modelId: "mdl_1" },
    );

    expect(mockedGetQueriesByIds).not.toHaveBeenCalled();
    expect(cancelQuery).not.toHaveBeenCalled();
  });

  it("cancels each distinct external job once, following cached copies one hop", async () => {
    stubQueryDocs([
      makeQuery("qry_a", {
        externalId: "job_1",
        externalIdMetadata: { location: "EU" },
      }),
      makeQuery("qry_b", { externalId: "job_1" }),
      makeQuery("qry_c", { cachedQueryUsed: "qry_src" }),
      makeQuery("qry_d", { cachedQueryUsed: "qry_src" }),
      makeQuery("qry_e", { cachedQueryUsed: "qry_src_no_job" }),
      makeQuery("qry_f"),
      makeQuery("qry_src", { externalId: "job_2" }),
      makeQuery("qry_src_no_job"),
    ]);
    const cancelQuery = jest.fn().mockResolvedValue(undefined);

    await cancelExternalJobsForQueries(
      context,
      makeCancellingIntegration(cancelQuery),
      ["qry_a", "qry_b", "qry_c", "qry_d", "qry_e", "qry_f"],
      { modelId: "mdl_1" },
    );

    expect(mockedGetQueriesByIds).toHaveBeenNthCalledWith(
      1,
      context,
      ["qry_a", "qry_b", "qry_c", "qry_d", "qry_e", "qry_f"],
      false,
    );
    expect(mockedGetQueriesByIds).toHaveBeenNthCalledWith(
      2,
      context,
      ["qry_src", "qry_src_no_job"],
      false,
    );
    expect(cancelQuery.mock.calls).toEqual([
      ["job_1", { location: "EU" }],
      ["job_2", undefined],
    ]);
  });

  it("skips the cached-source lookup when no doc is a cached copy", async () => {
    stubQueryDocs([makeQuery("qry_a", { externalId: "job_1" })]);
    const cancelQuery = jest.fn().mockResolvedValue(undefined);

    await cancelExternalJobsForQueries(
      context,
      makeCancellingIntegration(cancelQuery),
      ["qry_a"],
      { modelId: "mdl_1" },
    );

    expect(mockedGetQueriesByIds).toHaveBeenCalledTimes(1);
    expect(cancelQuery).toHaveBeenCalledWith("job_1", undefined);
  });

  it("issues warehouse cancels in chunks of 5", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `qry_${i}`);
    stubQueryDocs(ids.map((id) => makeQuery(id, { externalId: `job_${id}` })));
    const releases: (() => void)[] = [];
    const cancelQuery = jest.fn(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );

    const done = cancelExternalJobsForQueries(
      context,
      makeCancellingIntegration(cancelQuery),
      ids,
      { modelId: "mdl_1" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancelQuery).toHaveBeenCalledTimes(5);

    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancelQuery).toHaveBeenCalledTimes(7);

    releases.splice(0).forEach((release) => release());
    await done;
  });

  it("logs rejected cancels with the datasource and model ids", async () => {
    stubQueryDocs([makeQuery("qry_a", { externalId: "job_1" })]);

    await cancelExternalJobsForQueries(
      context,
      makeCancellingIntegration(jest.fn().mockRejectedValue(new Error("no"))),
      ["qry_a"],
      { modelId: "mdl_1" },
    );

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "job_1",
        datasourceId: "ds_1",
        modelId: "mdl_1",
      }),
      expect.stringContaining("no"),
    );
  });
});
