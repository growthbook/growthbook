import {
  hasStatusSchedule,
  scheduleSummary,
} from "@/components/Experiment/TabbedPage/statusSchedule";

const stopPlan = { enabled: true };

describe("hasStatusSchedule", () => {
  it.each([
    ["nothing", null, false],
    ["cleared dates", { startAt: null, stopAt: null, stopAfter: null }, false],
    [
      "only a stop plan",
      { stopAfter: null, scheduledStopPlan: stopPlan },
      false,
    ],
    ["a start", { startAt: "2026-10-30T09:00:00Z" }, true],
    [
      "an end with its stop plan",
      { stopAfter: { value: 2, unit: "weeks" }, scheduledStopPlan: stopPlan },
      true,
    ],
  ])("%s", (_, statusUpdateSchedule, expected) => {
    expect(hasStatusSchedule({ statusUpdateSchedule })).toBe(expected);
  });
});

describe("scheduleSummary", () => {
  it.each([
    [null, "Starts and ends manually."],
    [
      { stopAfter: { value: 1, unit: "hours" } },
      "Starts manually and ends after 1 hour.",
    ],
    [
      { stopAfter: { value: 14, unit: "days" } },
      "Starts manually and ends after 14 days.",
    ],
    [
      { startAt: "2026-10-28T00:00:00", stopAt: "2026-11-11T09:30:00" },
      "Starts Oct 28, 2026 12:00 AM and ends Nov 11, 2026 9:30 AM.",
    ],
  ] as const)("%j", (statusUpdateSchedule, expected) => {
    expect(scheduleSummary(statusUpdateSchedule)).toBe(expected);
  });
});
