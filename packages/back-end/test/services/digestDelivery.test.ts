import Agenda from "agenda";
import addDigestJob from "back-end/src/jobs/eventWebhookWeeklyDigest";
import {
  getSlackDigestScheduleUpdate,
  finishSlackDigestWindow,
} from "back-end/src/services/slack/digestSchedule";
import { EventModel } from "back-end/src/models/EventModel";
import {
  getSlackWebhooksWithDigestDue,
  getSlackWebhooksMissingDigestSchedule,
  claimSlackDigestRun,
  completeSlackDigestRun,
  isSlackDigestRunCurrent,
  releaseSlackDigestRun,
} from "back-end/src/models/EventWebhookModel";
import {
  postSlackMessage,
  SLACK_WORKSPACE_PLACEHOLDER_URL,
} from "back-end/src/services/slack/slackWebApi";
jest.mock("back-end/src/models/EventModel", () => ({
  EventModel: { find: jest.fn() },
}));
jest.mock("back-end/src/models/EventWebhookModel", () => ({
  getSlackWebhooksWithDigestDue: jest.fn(),
  getSlackWebhooksMissingDigestSchedule: jest.fn(),
  claimSlackDigestRun: jest.fn(),
  completeSlackDigestRun: jest.fn(),
  isSlackDigestRunCurrent: jest.fn(),
  releaseSlackDigestRun: jest.fn(),
  syncSlackDigestSchedule: jest.fn(),
}));
jest.mock("back-end/src/services/slackIntegration", () => ({
  getSlackWorkspaceTokenForTeam: jest.fn().mockResolvedValue("token"),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn().mockResolvedValue({}),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackWebApi"),
  postSlackMessage: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({ logger: { error: jest.fn() } }));
const dueAt = new Date("2026-09-11T09:00:00Z");
const leaseUntil = new Date("2026-09-11T09:10:00Z");
const hook = {
  id: "hook",
  organizationId: "org",
  enabled: true,
  payloadType: "slack",
  url: SLACK_WORKSPACE_PLACEHOLDER_URL,
  slack: { teamId: "team", channelId: "channel" },
  slackOptions: { experimentDigest: { frequency: "daily", hourUtc: 9 } },
  events: ["experiment.*"],
  projects: [],
  tags: [],
  environments: [],
  nextExperimentDigestAt: dueAt,
  dateUpdated: new Date("2026-09-01"),
} as Awaited<ReturnType<typeof getSlackWebhooksWithDigestDue>>[number];
let run: () => Promise<void>;
let stored: typeof hook;
function saveSettings(
  updates: Parameters<typeof getSlackDigestScheduleUpdate>[1],
) {
  const patch = getSlackDigestScheduleUpdate(stored, updates, new Date());
  stored = { ...stored, ...updates, ...patch.set, dateUpdated: new Date() };
  if ("nextExperimentDigestAt" in patch.unset)
    delete stored.nextExperimentDigestAt;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(dueAt);
  stored = { ...hook, experimentDigestLeaseUntil: leaseUntil };
  jest.mocked(getSlackWebhooksMissingDigestSchedule).mockResolvedValue([]);
  jest
    .mocked(getSlackWebhooksWithDigestDue)
    .mockImplementation(async () => [{ ...stored }]);
  jest.mocked(claimSlackDigestRun).mockResolvedValue({ leaseUntil });
  jest
    .mocked(isSlackDigestRunCurrent)
    .mockReset()
    .mockImplementation(
      async (snapshot) =>
        stored.dateUpdated.getTime() === snapshot.dateUpdated.getTime(),
    );
  jest.mocked(releaseSlackDigestRun).mockImplementation(async () => {
    delete stored.experimentDigestLeaseUntil;
  });
  jest
    .mocked(completeSlackDigestRun)
    .mockImplementation(
      async ({ dueAt: completedDue, nextRunAt, leaseUntil: owner }) => {
        await finishSlackDigestWindow({
          advance: async () => {
            if (
              stored.experimentDigestLeaseUntil?.getTime() !==
                owner.getTime() ||
              stored.nextExperimentDigestAt?.getTime() !==
                completedDue.getTime()
            )
              return false;
            if (nextRunAt) stored.nextExperimentDigestAt = nextRunAt;
            else delete stored.nextExperimentDigestAt;
            delete stored.experimentDigestLeaseUntil;
            return true;
          },
          release: async () => {
            delete stored.experimentDigestLeaseUntil;
          },
        });
      },
    );
  const cursor = async function* () {
    yield {
      event: "experiment.started",
      objectId: "exp",
      data: { data: { object: { experimentId: "exp" } } },
    };
  };
  jest.mocked(EventModel.find).mockReturnValue({
    sort: () => ({ lean: () => ({ cursor }) }),
  } as unknown as ReturnType<typeof EventModel.find>);
  const scheduled = {
    unique: () => scheduled,
    repeatEvery: () => scheduled,
    save: () => Promise.resolve(),
  };
  addDigestJob({
    define: (name: string, handler: () => Promise<void>) => {
      run = handler;
    },
    create: () => scheduled,
  } as unknown as Agenda);
  jest.mocked(postSlackMessage).mockReset().mockResolvedValue("message");
});
afterEach(() => jest.useRealTimers());
it("does not post when a settings save invalidates the run before sending", async () => {
  jest.mocked(isSlackDigestRunCurrent).mockImplementationOnce(async () => {
    saveSettings({ enabled: false });
    return false;
  });
  await run();
  expect(postSlackMessage).not.toHaveBeenCalled();
  expect(completeSlackDigestRun).not.toHaveBeenCalled();
  expect(stored.experimentDigestLeaseUntil).toBeUndefined();
});
it("advances the accepted window when unrelated settings save during the Slack request", async () => {
  jest.mocked(postSlackMessage).mockImplementationOnce(async () => {
    saveSettings({
      slackOptions: { ...hook.slackOptions, experimentCardFormat: "compact" },
    });
    return "accepted";
  });
  await run();
  expect(postSlackMessage).toHaveBeenCalledTimes(1);
  expect(completeSlackDigestRun).toHaveBeenCalledWith(
    expect.objectContaining({ dueAt, leaseUntil }),
  );
  expect(stored.nextExperimentDigestAt).toEqual(
    new Date("2026-09-12T09:00:00Z"),
  );
  expect(stored.experimentDigestLeaseUntil).toBeUndefined();
  jest.setSystemTime(new Date("2026-09-11T10:00:00Z"));
  await run();
  expect(postSlackMessage).toHaveBeenCalledTimes(1);
});
it("preserves an explicitly changed schedule when the older send completes", async () => {
  jest.mocked(postSlackMessage).mockImplementationOnce(async () => {
    saveSettings({
      slackOptions: {
        experimentDigest: { frequency: "monthly", dayOfMonth: 1, hourUtc: 9 },
      },
    });
    return "accepted";
  });
  await run();
  expect(stored.nextExperimentDigestAt).toEqual(
    new Date("2026-10-01T09:00:00Z"),
  );
  expect(stored.experimentDigestLeaseUntil).toBeUndefined();
});
