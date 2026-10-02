import type { ExperimentInterface } from "shared/types/experiment";
import { getExperimentReminderResets } from "back-end/src/services/experimentReminderState";

const experiment = {
  status: "running",
  statusUpdateSchedule: { stopAt: new Date("2026-09-14") },
} as ExperimentInterface;

it.each([
  ["running", "stopped"],
  ["stopped", "running"],
  ["running", "draft"],
  ["draft", "running"],
] as const)(
  "resets both reminders on %s → %s without requiring a scheduler pass",
  (before, after) => {
    expect(
      getExperimentReminderResets(
        { ...experiment, status: before },
        { ...experiment, status: after },
      ),
    ).toEqual(["ending-soon", "stale"]);
  },
);
it.each([new Date("2026-10-01"), new Date("2026-09-12"), undefined])(
  "resets ending-soon when the end date changes to %s",
  (stopAt) => {
    expect(
      getExperimentReminderResets(experiment, {
        ...experiment,
        statusUpdateSchedule: { stopAt },
      }),
    ).toEqual(["ending-soon"]);
  },
);
it("preserves markers on unrelated edits or equivalent date instances", () => {
  expect(
    getExperimentReminderResets(experiment, {
      ...experiment,
      name: "Renamed",
      statusUpdateSchedule: { stopAt: new Date("2026-09-14") },
    }),
  ).toEqual([]);
});
