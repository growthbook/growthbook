import {
  CANCEL_CONFIRMATION_DELAY_MS,
  cancelExternalQuery,
} from "back-end/src/services/queryCancellation";
import {
  ExternalQueryStatus,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { logger } from "back-end/src/util/logger";

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

describe("cancelExternalQuery", () => {
  it("does nothing when the integration cannot cancel", async () => {
    const integration = makeIntegration({});

    await cancelExternalQuery(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });

  it("warns immediately when the warehouse rejects the cancel request", async () => {
    const getExternalQueryStatus = jest.fn();
    const integration = makeIntegration({
      cancelQuery: jest.fn().mockRejectedValue(new Error("boom")),
      getExternalQueryStatus,
    });

    await cancelExternalQuery(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "q1", ...logContext }),
      expect.stringContaining("boom"),
    );
    expect(getExternalQueryStatus).not.toHaveBeenCalled();
  });

  it("skips confirmation when the warehouse reports the query already cancelled", async () => {
    jest.useFakeTimers();
    try {
      const getExternalQueryStatus = jest.fn();
      const integration = makeIntegration({
        cancelQuery: jest.fn().mockResolvedValue("cancelled"),
        getExternalQueryStatus,
      });

      await cancelExternalQuery(integration, { externalId: "q1" }, logContext);
      await flushConfirmation();

      expect(mockedLogger.warn).not.toHaveBeenCalled();
      expect(getExternalQueryStatus).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("skips confirmation when the integration cannot report status", async () => {
    const integration = makeIntegration({
      cancelQuery: jest.fn().mockResolvedValue("requested"),
    });

    await cancelExternalQuery(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
  });

  it("warns after the delay when the query is still running", async () => {
    jest.useFakeTimers();
    try {
      const integration = makeIntegration({
        cancelQuery: jest.fn().mockResolvedValue("requested"),
        getExternalQueryStatus: jest.fn().mockResolvedValue({
          state: "running",
        }),
      });

      await cancelExternalQuery(integration, { externalId: "q1" }, logContext);
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
        cancelQuery: jest.fn().mockResolvedValue("requested"),
        getExternalQueryStatus: jest.fn().mockResolvedValue(status),
      });

      await cancelExternalQuery(integration, { externalId: "q1" }, logContext);
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
        cancelQuery: jest.fn().mockResolvedValue("requested"),
        getExternalQueryStatus: jest.fn().mockResolvedValue({
          state: "unknown",
          reason: "expired",
        }),
      });

      await cancelExternalQuery(integration, { externalId: "q1" }, logContext);
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
        cancelQuery: jest.fn().mockResolvedValue("requested"),
        getExternalQueryStatus: jest.fn().mockRejectedValue(new Error("down")),
      });

      await cancelExternalQuery(integration, { externalId: "q1" }, logContext);
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
