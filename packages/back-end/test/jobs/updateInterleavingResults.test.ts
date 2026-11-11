import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { runInterleavingSnapshot } from "back-end/src/enterprise/services/interleavingAnalysis";
import { updateSingleInterleaving } from "back-end/src/jobs/updateInterleavingResults";

// Importing the model for real pulls in the whole context module graph and
// trips a circular initialization; the job only needs the scan function.
jest.mock("back-end/src/enterprise/models/InterleavingModel", () => ({
  dangerousFindInterleavingsToUpdate: jest.fn(async () => []),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));
jest.mock("back-end/src/enterprise/services/interleavingAnalysis", () => ({
  runInterleavingSnapshot: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGetContext = getContextForAgendaJobByOrgId as jest.MockedFunction<
  typeof getContextForAgendaJobByOrgId
>;
const mockRunSnapshot = runInterleavingSnapshot as jest.MockedFunction<
  typeof runInterleavingSnapshot
>;

const ORG_ID = "org_1";
const IL_ID = "il_1";
const HOUR = 60 * 60 * 1000;

// Everything the scan and the job's own guard both demand.
const eligible = {
  id: IL_ID,
  organization: ORG_ID,
  status: "running",
  archived: false,
  autoSnapshots: true,
  datasourceId: "ds_1",
  interleavingExposureQueryId: "ilq_1",
  userIdType: "user_id",
  metrics: [{ id: "met_1", analyses: [{ type: "preference" }] }],
  nextSnapshotAttempt: new Date(Date.now() - HOUR),
};

function makeContext({
  il = eligible,
  premium = true,
  updateSchedule = undefined,
  active = [],
}: {
  il?: Record<string, unknown> | null;
  premium?: boolean;
  updateSchedule?: { type: string; hours?: number };
  active?: unknown[];
} = {}) {
  const stamp = jest.fn(async () => undefined);
  const context = {
    org: { id: ORG_ID, settings: updateSchedule ? { updateSchedule } : {} },
    hasPremiumFeature: () => premium,
    models: {
      interleavings: {
        getById: jest.fn(async () => il),
        dangerousUpdateBypassPermission: stamp,
      },
      interleavingSnapshots: {
        listActiveForInterleaving: jest.fn(async () => active),
      },
    },
  };
  mockGetContext.mockResolvedValue(context as never);
  return { context, stamp, doc: il };
}

const jobFor = (data: Record<string, string> | undefined) =>
  ({ attrs: { data } }) as unknown as Parameters<
    typeof updateSingleInterleaving
  >[0];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("updateSingleInterleaving", () => {
  it("refreshes an eligible interleaving", async () => {
    const { stamp, doc } = makeContext();
    await updateSingleInterleaving(
      jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
    );
    expect(mockRunSnapshot).toHaveBeenCalledWith(expect.anything(), IL_ID);
    // Advanced before the run, so a hanging refresh can't block the next tick.
    expect(stamp).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        nextSnapshotAttempt: expect.any(Date),
        lastSnapshotAttempt: expect.any(Date),
      }),
    );
    expect(stamp.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunSnapshot.mock.invocationCallOrder[0],
    );
  });

  it("does nothing without job data", async () => {
    makeContext();
    await updateSingleInterleaving(jobFor(undefined));
    expect(mockGetContext).not.toHaveBeenCalled();
  });

  it("ignores an interleaving that has been deleted", async () => {
    const { stamp } = makeContext({ il: null });
    await updateSingleInterleaving(
      jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
    );
    expect(stamp).not.toHaveBeenCalled();
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });

  // The guard is stricter than the scan's filter, so a doc it rejects would
  // otherwise be re-selected and re-queued every five minutes forever.
  it.each([
    ["no exposure query", { interleavingExposureQueryId: "" }],
    ["no identifier type", { userIdType: "" }],
    ["no metrics", { metrics: [] }],
    ["archived", { archived: true }],
  ])("turns auto-updates off for one with %s", async (_label, overrides) => {
    const { stamp, doc } = makeContext({
      il: { ...eligible, ...overrides },
    });
    await updateSingleInterleaving(
      jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
    );
    expect(stamp).toHaveBeenCalledWith(doc, {
      autoSnapshots: false,
      nextSnapshotAttempt: undefined,
    });
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });

  it("waits until the next attempt is due", async () => {
    const { stamp } = makeContext({
      il: { ...eligible, nextSnapshotAttempt: new Date(Date.now() + HOUR) },
    });
    await updateSingleInterleaving(
      jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
    );
    expect(stamp).not.toHaveBeenCalled();
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });

  // Backs off rather than disabling, so re-licensing resumes on its own.
  it("defers a day when the plan does not allow interleaving", async () => {
    const { stamp } = makeContext({ premium: false });
    await updateSingleInterleaving(
      jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
    );
    expect(stamp).toHaveBeenCalledTimes(1);
    const [, arg] = stamp.mock.calls[0] as [
      string,
      { nextSnapshotAttempt: Date },
    ];
    expect(arg.nextSnapshotAttempt.getTime()).toBeGreaterThan(
      Date.now() + 23 * HOUR,
    );
    expect(arg).not.toHaveProperty("autoSnapshots");
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });

  it("turns auto-updates off when the org schedule is never", async () => {
    const { stamp, doc } = makeContext({
      updateSchedule: { type: "never" },
    });
    await updateSingleInterleaving(
      jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
    );
    expect(stamp).toHaveBeenCalledWith(doc, {
      autoSnapshots: false,
      nextSnapshotAttempt: undefined,
    });
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });

  it("skips the run while a refresh is still in flight", async () => {
    const { stamp } = makeContext({ active: [{ id: "ilsnp_1" }] });
    await updateSingleInterleaving(
      jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
    );
    // Still rescheduled, so it retries on the next tick.
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });

  it("swallows a failing refresh so the queue keeps draining", async () => {
    makeContext();
    mockRunSnapshot.mockRejectedValueOnce(new Error("warehouse down"));
    await expect(
      updateSingleInterleaving(
        jobFor({ organization: ORG_ID, interleavingId: IL_ID }),
      ),
    ).resolves.toBeUndefined();
  });
});
