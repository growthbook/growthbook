import {
  hasStatusSchedule,
  scheduleTimes,
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

describe("scheduleTimes", () => {
  const draft = { status: "draft" as const, phases: [] };
  it.each([
    [draft, { starts: null, ends: null }],
    [
      {
        ...draft,
        statusUpdateSchedule: {
          stopAfter: { value: 1, unit: "hours" as const },
        },
      },
      { starts: null, ends: "After 1 hour" },
    ],
    [
      {
        ...draft,
        statusUpdateSchedule: {
          stopAfter: { value: 14, unit: "days" as const },
        },
      },
      { starts: null, ends: "After 14 days" },
    ],
    [
      {
        ...draft,
        statusUpdateSchedule: {
          startAt: "2026-10-28T00:00:00",
          stopAt: "2026-11-11T09:30:00",
        },
      },
      { starts: "Oct 28, 2026 12:00 AM", ends: "Nov 11, 2026 9:30 AM" },
    ],
    // Once it's run, its own dates.
    [
      {
        status: "stopped" as const,
        phases: [
          {
            dateStarted: "2026-10-01T08:00:00",
            dateEnded: "2026-10-15T08:00:00",
          },
        ],
      },
      { starts: "Oct 1, 2026 8:00 AM", ends: "Oct 15, 2026 8:00 AM" },
    ],
  ])("%j", (experiment, expected) => {
    expect(
      scheduleTimes(
        experiment as unknown as Parameters<typeof scheduleTimes>[0],
      ),
    ).toEqual(expected);
  });
});
