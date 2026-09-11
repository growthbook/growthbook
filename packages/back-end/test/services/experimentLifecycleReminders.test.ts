import { ExperimentInterface } from "shared/types/experiment";
import {
  getExperimentById,
  dangerousGetExperimentsForLifecycleReminders,
  setExperimentNotificationState,
} from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { createEvent } from "back-end/src/models/EventModel";
import { checkExperimentLifecycleReminders } from "back-end/src/services/experimentLifecycleReminders";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  dangerousGetExperimentsForLifecycleReminders: jest.fn(),
  setExperimentNotificationState: jest.fn(),
}));
jest.mock("back-end/src/models/EventModel", () => ({ createEvent: jest.fn() }));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
  getEnvironmentIdsFromOrg: jest.fn(() => []),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
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
const renewLease = jest.fn(async () => {});
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(now);
  experiments = [fixture("manual")];
  jest
    .mocked(dangerousGetExperimentsForLifecycleReminders)
    .mockImplementation(async function* () {
      for (const experiment of experiments)
        yield { id: experiment.id, organization: experiment.organization };
    });
  jest
    .mocked(getExperimentById)
    .mockImplementation(
      async (context, id) =>
        experiments.find((experiment) => experiment.id === id) || null,
    );
  jest.mocked(getContextForAgendaJobByOrgId).mockResolvedValue({
    org: { id: "org", settings: { updateSchedule: { type: "never" } } },
  } as Awaited<ReturnType<typeof getContextForAgendaJobByOrgId>>);
  jest
    .mocked(setExperimentNotificationState)
    .mockImplementation(async ({ experiment, type, triggered }) => {
      experiment.pastNotifications = [
        ...(experiment.pastNotifications || []).filter((item) => item !== type),
        ...(triggered ? [type] : []),
      ];
    });
});
afterEach(() => jest.useRealTimers());
it("notifies manually refreshed experiments without a data source even when organization refreshes are disabled", async () => {
  await checkExperimentLifecycleReminders(renewLease);
  expect(
    jest.mocked(createEvent).mock.calls.map(([event]) => event.event),
  ).toEqual(["endingSoon", "stale"]);
  expect(renewLease).toHaveBeenCalledTimes(1);
});
it("retains deduplication across scheduler passes", async () => {
  await checkExperimentLifecycleReminders(renewLease);
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).toHaveBeenCalledTimes(2);
});
it("clears old markers after stopping and notifies again after restarting", async () => {
  experiments[0].pastNotifications = ["ending-soon", "stale"];
  experiments[0].status = "stopped";
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).not.toHaveBeenCalled();
  expect(experiments[0].pastNotifications).toEqual([]);
  experiments[0].status = "running";
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
it("continues checking other experiments after one lookup fails", async () => {
  experiments.push(fixture("other"));
  jest
    .mocked(getExperimentById)
    .mockRejectedValueOnce(new Error("Failed lookup"));
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).toHaveBeenCalledTimes(2);
  expect(getContextForAgendaJobByOrgId).toHaveBeenCalledTimes(1);
});
it("stops when the scheduler lease cannot be renewed", async () => {
  renewLease.mockRejectedValueOnce(new Error("Lease lost"));
  await expect(checkExperimentLifecycleReminders(renewLease)).rejects.toThrow(
    "Lease lost",
  );
  expect(createEvent).not.toHaveBeenCalled();
});

it("does not send if an experiment is archived after the candidate scan", async () => {
  experiments[0].archived = true;
  await checkExperimentLifecycleReminders(renewLease);
  expect(createEvent).not.toHaveBeenCalled();
});
