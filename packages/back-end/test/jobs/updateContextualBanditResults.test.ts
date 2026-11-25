import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { updateSingleContextualBandit } from "back-end/src/jobs/updateContextualBanditResults";
import { PlanDoesNotAllowError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

// Importing the model for real pulls in the whole context module graph and
// trips a circular initialization; the job only needs the scan function.
jest.mock("back-end/src/enterprise/models/ContextualBanditModel", () => ({
  dangerousFindContextualBanditsToUpdate: jest.fn(async () => []),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));
jest.mock("back-end/src/enterprise/services/contextualBandits", () => ({
  runContextualBanditSnapshot: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGetContext = getContextForAgendaJobByOrgId as jest.MockedFunction<
  typeof getContextForAgendaJobByOrgId
>;
const mockRunSnapshot = runContextualBanditSnapshot as jest.MockedFunction<
  typeof runContextualBanditSnapshot
>;
const mockLogger = logger as jest.Mocked<typeof logger>;

const ORG_ID = "org_1";
const CB_ID = "cb_1";
const HOUR = 60 * 60 * 1000;

const eligible = {
  id: CB_ID,
  organization: ORG_ID,
  status: "running",
  autoSnapshots: true,
  datasource: "ds_1",
  dateStarted: new Date(Date.now() - 2 * HOUR),
  stage: "exploit",
  stageDateStarted: new Date(Date.now() - 2 * HOUR),
  scheduleValue: 6,
  scheduleUnit: "hours",
  burnInValue: 1,
  burnInUnit: "hours",
  nextSnapshotAttempt: new Date(Date.now() - HOUR),
};

function makeContext({
  cb = eligible,
  premium = true,
}: {
  cb?: Record<string, unknown> | null;
  premium?: boolean;
} = {}) {
  const bypassUpdate = jest.fn(async () => cb);
  const update = jest.fn(async () => {
    throw new Error("Your organization does not have access to this feature.");
  });
  const context = {
    org: { id: ORG_ID, settings: {} },
    hasPremiumFeature: jest.fn(() => premium),
    models: {
      contextualBandits: {
        getById: jest.fn(async () => cb),
        dangerousUpdateBypassPermission: bypassUpdate,
        update,
      },
    },
  };
  mockGetContext.mockResolvedValue(context as never);
  return { context, bypassUpdate, update, doc: cb };
}

const jobFor = (data: Record<string, string> | undefined) =>
  ({ attrs: { data } }) as unknown as Parameters<
    typeof updateSingleContextualBandit
  >[0];

const runJob = () =>
  updateSingleContextualBandit(
    jobFor({ organization: ORG_ID, contextualBanditId: CB_ID }),
  );

beforeEach(() => {
  jest.clearAllMocks();
});

describe("updateSingleContextualBandit", () => {
  it("advances the schedule and refreshes an eligible bandit", async () => {
    const { bypassUpdate, update, doc, context } = makeContext();
    await runJob();

    expect(context.hasPremiumFeature).toHaveBeenCalledWith(
      "contextual-bandits",
    );
    expect(bypassUpdate).toHaveBeenCalledTimes(1);
    const [arg0, arg1] = bypassUpdate.mock.calls[0] as unknown as [
      unknown,
      { nextSnapshotAttempt: Date; lastSnapshotAttempt: Date },
    ];
    expect(arg0).toBe(doc);
    // Next 6-hour boundary after a start two hours ago.
    expect(arg1.nextSnapshotAttempt.getTime()).toBe(
      eligible.dateStarted.getTime() + 6 * HOUR,
    );
    expect(arg1.lastSnapshotAttempt).toEqual(expect.any(Date));
    expect(update).not.toHaveBeenCalled();

    expect(mockRunSnapshot).toHaveBeenCalledWith(context, doc, {
      triggeredBy: "scheduled",
      wait: true,
    });
    // Advanced before the run, so a failing refresh can't re-queue every tick.
    expect(bypassUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunSnapshot.mock.invocationCallOrder[0],
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("does nothing without job data", async () => {
    makeContext();
    await updateSingleContextualBandit(jobFor(undefined));
    expect(mockGetContext).not.toHaveBeenCalled();
  });

  it("ignores a bandit that has been deleted", async () => {
    const { bypassUpdate } = makeContext({ cb: null });
    await runJob();
    expect(bypassUpdate).not.toHaveBeenCalled();
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });

  it("pauses auto-updates when the plan does not allow contextual bandits", async () => {
    const { bypassUpdate, update, doc } = makeContext({ premium: false });
    await runJob();

    expect(bypassUpdate).toHaveBeenCalledTimes(1);
    expect(bypassUpdate).toHaveBeenCalledWith(doc, { autoSnapshots: false });
    expect(update).not.toHaveBeenCalled();
    expect(mockRunSnapshot).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { organization: ORG_ID, contextualBanditId: CB_ID },
      expect.stringContaining(CB_ID),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("falls back to a fixed delay when the schedule can't be computed", async () => {
    const { bypassUpdate } = makeContext({
      cb: { ...eligible, scheduleValue: undefined },
    });
    const before = Date.now();
    await runJob();

    expect(bypassUpdate).toHaveBeenCalledTimes(1);
    const [, arg1] = bypassUpdate.mock.calls[0] as unknown as [
      unknown,
      { nextSnapshotAttempt: Date },
    ];
    const next = arg1.nextSnapshotAttempt.getTime();
    expect(next).toBeGreaterThanOrEqual(before + HOUR);
    expect(next).toBeLessThanOrEqual(Date.now() + HOUR);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG_ID,
        contextualBanditId: CB_ID,
        err: expect.any(Error),
      }),
      expect.stringContaining(CB_ID),
    );
    // The run re-derives the same schedule and would only throw again.
    expect(mockRunSnapshot).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("does not run the snapshot when the schedule write fails", async () => {
    const { bypassUpdate } = makeContext();
    bypassUpdate.mockRejectedValueOnce(new Error("db down"));
    await expect(runJob()).resolves.toBeUndefined();

    expect(mockRunSnapshot).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: ORG_ID,
        contextualBanditId: CB_ID,
      }),
      expect.stringContaining(CB_ID),
    );
  });

  it("logs a plan error from the run as a warning, not an error", async () => {
    makeContext();
    mockRunSnapshot.mockRejectedValueOnce(
      new PlanDoesNotAllowError(
        "Contextual Bandits require an Enterprise plan.",
      ),
    );
    await expect(runJob()).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("logs an unexpected run failure as an error with context", async () => {
    makeContext();
    const err = new Error("warehouse down");
    mockRunSnapshot.mockRejectedValueOnce(err);
    await expect(runJob()).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledWith(
      { organization: ORG_ID, contextualBanditId: CB_ID, err },
      expect.stringContaining(CB_ID),
    );
  });
});
