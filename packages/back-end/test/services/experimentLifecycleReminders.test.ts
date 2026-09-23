import { vi } from "vitest";
import { ExperimentInterface } from "shared/types/experiment";
import { getExperimentReminderResets } from "back-end/src/services/experimentReminderState";
import {
  getExperimentsByIds,
  dangerousGetExperimentsForLifecycleReminders,
  setExperimentNotificationState,
} from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { createEvent } from "back-end/src/models/EventModel";
import { checkExperimentLifecycleReminders } from "back-end/src/services/experimentLifecycleReminders";

vi.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentsByIds: vi.fn(),
  dangerousGetExperimentsForLifecycleReminders: vi.fn(),
  setExperimentNotificationState: vi.fn(),
}));
vi.mock("back-end/src/models/EventModel", () => ({ createEvent: vi.fn() }));
// Reminders read the latest snapshot for the footer's unit count.
vi.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSuccessfulSnapshot: vi.fn().mockResolvedValue(null),
}));
vi.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: vi.fn(),
  getEnvironmentIdsFromOrg: vi.fn(() => []),
}));
vi.mock("back-end/src/util/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));
const now = new Date("2026-09-11T12:00:00Z");
const day = 86400000;
const fixture = (id: string): ExperimentInterface =>
  ({
    id,
    organization: "org",
    name: "Manual experiment",
    status: "running",
    type: "standard",
    autoSnapshots: false,
    datasource: "",
    phases: [{ dateStarted: new Date(now.getTime() - 100 * day) }],
    variations: [],
    tags: [],
    pastNotifications: [],
    statusUpdateSchedule: { stopAt: new Date(now.getTime() + day) },
  }) as unknown as ExperimentInterface;
let experiments: ExperimentInterface[];
const renewLease = vi.fn(async () => {});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers().setSystemTime(now);
  experiments = [fixture("manual")];
  vi.mocked(dangerousGetExperimentsForLifecycleReminders).mockImplementation(
    async function* () {
      for (const experiment of experiments)
        yield { id: experiment.id, organization: experiment.organization };
    },
  );
  vi.mocked(getExperimentsByIds).mockImplementation(async (context, ids) =>
    experiments.filter(
      (experiment) =>
        ids.includes(experiment.id) &&
        experiment.organization === context.org.id,
    ),
  );
  vi.mocked(getContextForAgendaJobByOrgId).mockImplementation(
    async (id) =>
      ({
        org: { id, settings: { updateSchedule: { type: "never" } } },
      }) as Awaited<ReturnType<typeof getContextForAgendaJobByOrgId>>,
  );
  vi.mocked(setExperimentNotificationState).mockImplementation(
    async ({ experiment, type, triggered }) => {
      experiment.pastNotifications = [
        ...(experiment.pastNotifications || []).filter((item) => item !== type),
        ...(triggered ? [type] : []),
      ];
    },
  );
});
afterEach(() => vi.useRealTimers());
it("notifies manually refreshed experiments without a data source even when organization refreshes are disabled", async () => {
  await checkExperimentLifecycleReminders(renewLease);
  expect(
    vi.mocked(createEvent).mock.calls.map(([event]) => event.event),
  ).toEqual(["status.endingSoon", "status.stale"]);
  expect(renewLease).toHaveBeenCalledTimes(1);
});
it("retains deduplication across scheduler passes", async () => {
  await checkExperimentLifecycleReminders(renewLease);
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).toHaveBeenCalledTimes(2);
});
it("resets ending-soon state when the schedule is extended", async () => {
  experiments[0].pastNotifications = ["ending-soon", "stale"];
  experiments[0].statusUpdateSchedule = {
    stopAt: new Date(now.getTime() + 10 * day),
  };
  await checkExperimentLifecycleReminders(renewLease);
  expect(experiments[0].pastNotifications).toEqual(["stale"]);
  expect(createEvent).not.toHaveBeenCalled();
});
it("continues with the next organization after one batch fails", async () => {
  experiments.push({ ...fixture("other"), organization: "org2" });
  vi.mocked(getExperimentsByIds).mockRejectedValueOnce(
    new Error("Failed lookup"),
  );
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).toHaveBeenCalledTimes(2);
  expect(getContextForAgendaJobByOrgId).toHaveBeenCalledTimes(2);
});

it("loads each organization's candidates in one batch", async () => {
  experiments.push(fixture("other"));
  await checkExperimentLifecycleReminders(renewLease);
  expect(getExperimentsByIds).toHaveBeenCalledTimes(1);
  expect(getExperimentsByIds).toHaveBeenCalledWith(expect.anything(), [
    "manual",
    "other",
  ]);
  expect(createEvent).toHaveBeenCalledTimes(4);
});
it("stops when the scheduler lease cannot be renewed", async () => {
  renewLease.mockRejectedValueOnce(new Error("Lease lost"));
  await expect(checkExperimentLifecycleReminders(renewLease)).rejects.toThrow(
    "Lease lost",
  );
  expect(createEvent).not.toHaveBeenCalled();
});

it("does not send if an experiment is archived or stopped after the candidate scan", async () => {
  experiments[0].archived = true;
  experiments.push({ ...fixture("stopped"), status: "stopped" });
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).not.toHaveBeenCalled();
});

it("leaves holdout backing experiments to the holdout lifecycle", async () => {
  experiments[0].type = "holdout";
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).not.toHaveBeenCalled();
});

function applyReminderChange(changes: Partial<ExperimentInterface>) {
  const previous = experiments[0];
  const updated = { ...previous, ...changes };
  const reset = getExperimentReminderResets(previous, updated);
  updated.pastNotifications = (previous.pastNotifications ?? []).filter(
    (type) => !reset.includes(type),
  );
  experiments[0] = updated;
}

it("notifies again after a stop and restart between scheduler passes", async () => {
  await checkExperimentLifecycleReminders(renewLease);
  vi.mocked(createEvent).mockClear();
  applyReminderChange({ status: "stopped" });
  applyReminderChange({ status: "running" });
  await checkExperimentLifecycleReminders(renewLease);
  expect(
    vi.mocked(createEvent).mock.calls.map(([event]) => event.event),
  ).toEqual(["status.endingSoon", "status.stale"]);
});

it("notifies about a revised end date without repeating the stale reminder", async () => {
  await checkExperimentLifecycleReminders(renewLease);
  vi.mocked(createEvent).mockClear();
  applyReminderChange({
    statusUpdateSchedule: { stopAt: new Date(now.getTime() + 10 * day) },
  });
  applyReminderChange({
    statusUpdateSchedule: { stopAt: new Date(now.getTime() + 2 * day) },
  });
  await checkExperimentLifecycleReminders(renewLease);
  expect(
    vi.mocked(createEvent).mock.calls.map(([event]) => event.event),
  ).toEqual(["status.endingSoon"]);
});
