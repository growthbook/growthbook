import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { updateSingleContextualBandit } from "back-end/src/jobs/updateContextualBanditResults";

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

const ORG_ID = "org_1";
const CB_ID = "cb_1";
const HOUR = 60 * 60 * 1000;

const cb = {
  id: CB_ID,
  organization: ORG_ID,
  stage: "exploit",
  dateStarted: new Date(Date.now() - 24 * HOUR),
  burnInValue: 1,
  burnInUnit: "days",
  scheduleValue: 6,
  scheduleUnit: "hours",
  nextSnapshotAttempt: new Date(Date.now() - HOUR),
};

function makeContext({ premium = true }: { premium?: boolean } = {}) {
  const update = jest.fn(async () => undefined);
  const bypass = jest.fn(async () => undefined);
  const context = {
    hasPremiumFeature: () => premium,
    models: {
      contextualBandits: {
        getById: jest.fn(async () => cb),
        update,
        dangerousUpdateBypassPermission: bypass,
      },
    },
  };
  mockGetContext.mockResolvedValue(context as never);
  return { update, bypass };
}

const job = {
  attrs: { data: { organization: ORG_ID, contextualBanditId: CB_ID } },
} as unknown as Parameters<typeof updateSingleContextualBandit>[0];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("updateSingleContextualBandit", () => {
  it("reschedules before refreshing a licensed bandit", async () => {
    const { update, bypass } = makeContext();
    await updateSingleContextualBandit(job);
    expect(update).toHaveBeenCalledWith(
      cb,
      expect.objectContaining({
        nextSnapshotAttempt: expect.any(Date),
        lastSnapshotAttempt: expect.any(Date),
      }),
    );
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunSnapshot.mock.invocationCallOrder[0],
    );
    expect(bypass).not.toHaveBeenCalled();
  });

  // The gated update() throws on a lapsed plan, which used to leave
  // nextSnapshotAttempt in the past and re-queue the bandit every five minutes.
  // Backs off rather than disabling, so re-licensing resumes on its own.
  it("defers a day when the plan does not allow contextual bandits", async () => {
    const { update, bypass } = makeContext({ premium: false });
    await updateSingleContextualBandit(job);
    expect(bypass).toHaveBeenCalledTimes(1);
    const [, arg] = bypass.mock.calls[0] as unknown as [
      unknown,
      { nextSnapshotAttempt: Date },
    ];
    expect(arg.nextSnapshotAttempt.getTime()).toBeGreaterThan(
      Date.now() + 23 * HOUR,
    );
    expect(arg).not.toHaveProperty("autoSnapshots");
    expect(update).not.toHaveBeenCalled();
    expect(mockRunSnapshot).not.toHaveBeenCalled();
  });
});
