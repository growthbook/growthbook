import {
  allDates,
  hasStatusSchedule,
  headerDates,
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
  const upcoming = { started: false, ended: false };
  it.each([
    [draft, { ...upcoming, starts: null, ends: null }],
    [
      {
        ...draft,
        statusUpdateSchedule: {
          stopAfter: { value: 1, unit: "hours" as const },
        },
      },
      { ...upcoming, starts: null, ends: "After 1 hour" },
    ],
    [
      {
        ...draft,
        statusUpdateSchedule: {
          stopAfter: { value: 14, unit: "days" as const },
        },
      },
      { ...upcoming, starts: null, ends: "After 14 days" },
    ],
    [
      {
        ...draft,
        statusUpdateSchedule: {
          startAt: "2026-10-28T00:00:00",
          stopAt: "2026-11-11T09:30:00",
        },
      },
      {
        ...upcoming,
        starts: "Oct 28, 2026 12:00 AM",
        ends: "Nov 11, 2026 9:30 AM",
      },
    ],
    // Running past its scheduled end hasn't ended it.
    [
      {
        status: "running" as const,
        phases: [{ dateStarted: "2026-10-01T08:00:00" }],
        statusUpdateSchedule: {
          startAt: "2026-09-30T00:00:00",
          stopAt: "2026-10-10T00:00:00",
        },
      },
      {
        started: true,
        ended: false,
        starts: "Oct 1, 2026 8:00 AM",
        ends: "Oct 10, 2026 12:00 AM",
      },
    ],
    // Once it's stopped, when it actually did.
    [
      {
        status: "stopped" as const,
        phases: [
          {
            dateStarted: "2026-10-01T08:00:00",
            dateEnded: "2026-10-15T08:00:00",
          },
        ],
        statusUpdateSchedule: { stopAt: "2026-10-10T00:00:00" },
      },
      {
        started: true,
        ended: true,
        starts: "Oct 1, 2026 8:00 AM",
        ends: "Oct 15, 2026 8:00 AM",
      },
    ],
  ])("%j", (experiment, expected) => {
    expect(scheduleTimes(experiment)).toEqual(expected);
  });
});

describe("headerDates", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const base = {
    type: "standard" as const,
    archived: false,
    dateCreated: "2025-09-19T12:00:00Z",
  };
  const draft = { ...base, status: "draft" as const, phases: [] };
  const running = {
    ...base,
    status: "running" as const,
    phases: [{ dateStarted: "2026-01-14T12:00:00Z" }],
  };
  const futureEnd = { stopAt: "2026-11-30T12:00:00Z" };
  const created = { label: "Created", value: "Sep 19, 2025" };
  const started = { label: "Started", value: "Jan 14, 2026" };
  it.each([
    ["a draft", draft, [created]],
    [
      "a draft that ends a span after it starts",
      {
        ...draft,
        statusUpdateSchedule: {
          stopAfter: { value: 2, unit: "days" as const },
        },
      },
      [created, { label: "Ends", value: "2 days after start" }],
    ],
    [
      "a running experiment with an end ahead",
      { ...running, statusUpdateSchedule: futureEnd },
      [started, { label: "Ends", value: "Nov 30, 2026" }],
    ],
    [
      "a running experiment past its end",
      { ...running, statusUpdateSchedule: { stopAt: "2026-10-01T12:00:00Z" } },
      [started],
    ],
    [
      "an archived experiment, whose end never fires",
      { ...running, archived: true, statusUpdateSchedule: futureEnd },
      [started],
    ],
    [
      "a stopped experiment's latest phase",
      {
        ...base,
        status: "stopped" as const,
        phases: [
          { dateStarted: "2025-12-01T12:00:00Z" },
          {
            dateStarted: "2026-01-14T12:00:00Z",
            dateEnded: "2026-02-03T12:00:00Z",
          },
        ],
        statusUpdateSchedule: futureEnd,
      },
      [
        { label: "Latest phase started", value: "Jan 14, 2026" },
        { label: "Ended", value: "Feb 3, 2026" },
      ],
    ],
    [
      "a holdout, from its first phase",
      {
        ...running,
        type: "holdout" as const,
        phases: [
          { dateStarted: "2025-12-01T12:00:00Z" },
          { dateStarted: "2026-01-14T12:00:00Z" },
        ],
      },
      [{ label: "Started", value: "Dec 1, 2025" }],
    ],
  ])("%s", (_, experiment, expected) => {
    expect(headerDates(experiment, now)).toEqual(expected);
  });
});

describe("allDates", () => {
  const base = {
    type: "standard" as const,
    archived: false,
    dateCreated: "2025-09-19T12:00:00Z",
  };
  const created = { label: "Created", value: "Sep 19, 2025" };
  const running = {
    ...base,
    status: "running" as const,
    phases: [{ dateStarted: "2026-01-14T12:00:00Z" }],
  };
  // Scheduled times read in the viewer's zone.
  const at = (value: string) => expect.stringMatching(new RegExp(`^${value}`));
  it.each([
    ["a draft", { ...base, status: "draft" as const, phases: [] }, [created]],
    [
      "a scheduled draft",
      {
        ...base,
        status: "draft" as const,
        phases: [],
        statusUpdateSchedule: {
          startAt: "2026-10-30T09:00:00",
          stopAfter: { value: 2, unit: "days" as const },
        },
      },
      [
        created,
        { label: "Scheduled start", value: at("Oct 30, 2026 at 9:00 AM") },
        { label: "Scheduled end", value: "2 days after start" },
      ],
    ],
    [
      "a running experiment with an end",
      { ...running, statusUpdateSchedule: { stopAt: "2026-11-30T09:00:00" } },
      [
        created,
        { label: "Started", value: "Jan 14, 2026" },
        { label: "Scheduled end", value: at("Nov 30, 2026 at 9:00 AM") },
      ],
    ],
    [
      "an archived experiment, whose end never fires",
      {
        ...running,
        archived: true,
        statusUpdateSchedule: { stopAt: "2026-11-30T09:00:00" },
      },
      [created, { label: "Started", value: "Jan 14, 2026" }],
    ],
    [
      "each phase of a running experiment",
      {
        ...running,
        phases: [
          {
            dateStarted: "2025-12-01T12:00:00Z",
            dateEnded: "2026-01-14T12:00:00Z",
          },
          { dateStarted: "2026-01-14T12:00:00Z" },
        ],
      },
      [
        created,
        { label: "Phase 1", value: "Dec 1, 2025 – Jan 14, 2026" },
        { label: "Phase 2", value: "Jan 14, 2026 – now" },
      ],
    ],
    [
      "a stopped holdout's periods",
      {
        ...base,
        type: "holdout" as const,
        status: "stopped" as const,
        phases: [
          {
            dateStarted: "2025-12-01T12:00:00Z",
            dateEnded: "2026-01-14T12:00:00Z",
          },
          {
            dateStarted: "2026-01-14T12:00:00Z",
            dateEnded: "2026-02-03T12:00:00Z",
          },
        ],
      },
      [
        created,
        { label: "Holdout", value: "Dec 1, 2025 – Jan 14, 2026" },
        { label: "Analysis", value: "Jan 14, 2026 – Feb 3, 2026" },
      ],
    ],
  ])("%s", (_, experiment, expected) => {
    expect(allDates(experiment)).toEqual(expected);
  });
});
