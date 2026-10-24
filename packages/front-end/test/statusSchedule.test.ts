import { hasStatusSchedule } from "@/components/Experiment/TabbedPage/statusSchedule";

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
