import { Mocked, vi } from "vitest";
import {
  CANCEL_CONFIRMATION_DELAY_MS,
  cancelQueryAndConfirm,
} from "back-end/src/services/queryCancellation";
import {
  ExternalQueryStatus,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { logger } from "back-end/src/util/logger";

vi.mock("back-end/src/util/logger", () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const mockedLogger = logger as Mocked<typeof logger>;

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
  vi.advanceTimersByTime(CANCEL_CONFIRMATION_DELAY_MS);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cancelQueryAndConfirm", () => {
  it("does nothing when the integration cannot cancel", async () => {
    const integration = makeIntegration({});

    await cancelQueryAndConfirm(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });

  it("warns immediately when the warehouse rejects the cancel request", async () => {
    const getExternalQueryStatus = vi.fn();
    const integration = makeIntegration({
      cancelQuery: vi.fn().mockRejectedValue(new Error("boom")),
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
      cancelQuery: vi.fn().mockResolvedValue(undefined),
    });

    await cancelQueryAndConfirm(integration, { externalId: "q1" }, logContext);

    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
  });

  it("warns after the delay when the query is still running", async () => {
    vi.useFakeTimers();
    try {
      const integration = makeIntegration({
        cancelQuery: vi.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: vi.fn().mockResolvedValue({
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
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it.each<ExternalQueryStatus>([
    { state: "succeeded" },
    { state: "failed", error: "nope" },
  ])("does not warn when the query is %j", async (status) => {
    vi.useFakeTimers();
    try {
      const integration = makeIntegration({
        cancelQuery: vi.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: vi.fn().mockResolvedValue(status),
      });

      await cancelQueryAndConfirm(
        integration,
        { externalId: "q1" },
        logContext,
      );
      await flushConfirmation();

      expect(mockedLogger.warn).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("warns with the reason when the status is unknown", async () => {
    vi.useFakeTimers();
    try {
      const integration = makeIntegration({
        cancelQuery: vi.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: vi.fn().mockResolvedValue({
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
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("warns instead of rejecting when the confirmation probe throws", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const integration = makeIntegration({
        cancelQuery: vi.fn().mockResolvedValue(undefined),
        getExternalQueryStatus: vi.fn().mockRejectedValue(new Error("down")),
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
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
