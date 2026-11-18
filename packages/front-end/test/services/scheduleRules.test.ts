import { describe, expect, it } from "vitest";
import {
  rampCompletedAt,
  rampScheduleDates,
  rampStepReachedAt,
  scheduleVerb,
} from "@/services/scheduleRules";

const now = new Date("2026-11-05T12:00:00Z");

describe("scheduleVerb", () => {
  it.each([
    ["2026-11-06T00:00:00Z", "Starts"],
    ["2026-04-27T00:00:00Z", "Started"],
    // The moment it arrives, it has started.
    ["2026-11-05T12:00:00Z", "Started"],
  ])("%s reads %s", (date, expected) => {
    expect(scheduleVerb(date, "Starts", "Started", now)).toBe(expected);
  });
});

type Schedule = Parameters<typeof rampScheduleDates>[0];
const schedule = (fields: Partial<Schedule>): Schedule => ({
  status: "completed",
  steps: [],
  startDate: null,
  startedAt: null,
  cutoffDate: null,
  eventHistory: [],
  dateUpdated: new Date("2026-06-01T00:00:00Z"),
  ...fields,
});
const at = (iso: string) => new Date(iso);

describe("rampCompletedAt", () => {
  it("reads the last completed event, over a later update", () => {
    const rs = schedule({
      eventHistory: [
        { type: "completed", timestamp: at("2026-05-01T00:00:00Z") },
        { type: "restart", timestamp: at("2026-05-02T00:00:00Z") },
        { type: "completed", timestamp: at("2026-05-13T00:00:00Z") },
      ],
      dateUpdated: at("2026-07-01T00:00:00Z"),
    });
    expect(rampCompletedAt(rs)).toEqual(at("2026-05-13T00:00:00Z"));
  });

  it("falls back to the last update without a completed event", () => {
    expect(rampCompletedAt(schedule({}))).toEqual(at("2026-06-01T00:00:00Z"));
  });

  it("is null until the schedule completes", () => {
    expect(rampCompletedAt(schedule({ status: "running" }))).toBeNull();
  });
});

describe("rampScheduleDates", () => {
  const labels = (rs: Schedule) => {
    const { start, end } = rampScheduleDates(rs, now);
    return [start, end].map((d) => d && [d.label, d.date.toISOString()]);
  };
  const completedEvent = (iso: string) => [
    { type: "completed" as const, timestamp: at(iso) },
  ];
  const step = { interval: 60, actions: [] };

  it("reads a finished enable-only schedule as when it actually enabled", () => {
    const rs = schedule({
      startDate: at("2026-04-27T07:00:00Z"),
      startedAt: at("2026-05-01T16:20:00Z"),
      eventHistory: completedEvent("2026-05-13T19:27:00Z"),
    });
    expect(labels(rs)).toEqual([["Enabled", "2026-05-01T16:20:00.000Z"], null]);
  });

  it("keeps an enable that hasn't happened as upcoming, even once its date passes", () => {
    const rs = schedule({
      status: "pending",
      startDate: at("2026-04-27T07:00:00Z"),
    });
    expect(labels(rs)).toEqual([["Enables", "2026-04-27T07:00:00.000Z"], null]);
  });

  it("gives a two-sided simple schedule both ends", () => {
    const rs = schedule({
      status: "running",
      startDate: at("2026-05-01T00:00:00Z"),
      startedAt: at("2026-05-01T00:00:00Z"),
      cutoffDate: at("2026-12-01T00:00:00Z"),
    });
    expect(labels(rs)).toEqual([
      ["Enabled", "2026-05-01T00:00:00.000Z"],
      ["Disables", "2026-12-01T00:00:00.000Z"],
    ]);
  });

  it("gives a finished ramp its start and completion", () => {
    const rs = schedule({
      steps: [step],
      startedAt: at("2026-05-01T00:00:00Z"),
      eventHistory: completedEvent("2026-05-13T00:00:00Z"),
    });
    expect(labels(rs)).toEqual([
      ["Started", "2026-05-01T00:00:00.000Z"],
      ["Completed", "2026-05-13T00:00:00.000Z"],
    ]);
  });

  it("ends a ramp on its disable date instead of the completion", () => {
    const rs = schedule({
      steps: [step],
      startedAt: at("2026-05-01T00:00:00Z"),
      cutoffDate: at("2026-06-01T00:00:00Z"),
      eventHistory: completedEvent("2026-06-01T00:00:05Z"),
    });
    expect(labels(rs)).toEqual([
      ["Started", "2026-05-01T00:00:00.000Z"],
      ["Disabled", "2026-06-01T00:00:00.000Z"],
    ]);
  });
});

describe("rampStepReachedAt", () => {
  const rs = {
    eventHistory: [
      {
        type: "started" as const,
        timestamp: at("2026-05-01T00:00:00Z"),
        stepIndex: 0,
      },
      {
        type: "step-advanced" as const,
        timestamp: at("2026-05-02T00:00:00Z"),
        stepIndex: 1,
      },
      {
        type: "rollback" as const,
        timestamp: at("2026-05-03T00:00:00Z"),
        stepIndex: 0,
      },
      {
        type: "step-jumped" as const,
        timestamp: at("2026-05-04T00:00:00Z"),
        stepIndex: 1,
      },
    ],
  };

  it("takes the latest arrival at the step", () => {
    expect(rampStepReachedAt(rs, 1)).toEqual(at("2026-05-04T00:00:00Z"));
  });

  it("counts the start as reaching the first step", () => {
    expect(rampStepReachedAt(rs, 0)).toEqual(at("2026-05-01T00:00:00Z"));
  });

  it("is null for a step never reached", () => {
    expect(rampStepReachedAt(rs, 2)).toBeNull();
  });
});
