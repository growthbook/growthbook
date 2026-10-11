import { describe, expect, it } from "vitest";
import {
  isEndingSoon,
  isUnhealthy,
  needsDecision,
  tileTrend,
} from "@/services/experimentListTiles";

const now = new Date("2026-10-10T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const inDays = (n: number) => daysAgo(-n);

const base = {
  status: "running" as const,
  statusIndicator: {
    color: "gray" as const,
    status: "Running" as const,
    sortOrder: 0,
  },
  healthState: null,
  nextScheduledStatusUpdate: null,
};

describe("tile membership", () => {
  it("needs a decision for ship, roll back, review and awaiting decision", () => {
    for (const detailedStatus of [
      "Ship now",
      "Roll back now",
      "Ready for review",
      "Awaiting decision",
    ]) {
      expect(
        needsDecision({
          ...base,
          statusIndicator: { ...base.statusIndicator, detailedStatus },
        }),
      ).toBe(true);
    }
    expect(
      needsDecision({
        ...base,
        statusIndicator: {
          ...base.statusIndicator,
          detailedStatus: "Unhealthy",
        },
      }),
    ).toBe(false);
  });

  it("is unhealthy only in the unhealthy health state", () => {
    expect(isUnhealthy({ ...base, healthState: "unhealthy" })).toBe(true);
    expect(isUnhealthy({ ...base, healthState: "no-data" })).toBe(false);
  });

  it("ends soon when running with a stop scheduled in the next 7 days", () => {
    const stopIn = (days: number) => ({
      ...base,
      nextScheduledStatusUpdate: { type: "stop" as const, date: inDays(days) },
    });
    expect(isEndingSoon(stopIn(3), now)).toBe(true);
    expect(isEndingSoon(stopIn(10), now)).toBe(false);
    expect(isEndingSoon(stopIn(-1), now)).toBe(false);
    expect(isEndingSoon({ ...stopIn(3), status: "draft" }, now)).toBe(false);
  });
});

describe("tileTrend", () => {
  it("counts each of the last weeks, oldest first", () => {
    const { series } = tileTrend(
      [daysAgo(1), daysAgo(2), daysAgo(9), daysAgo(20)],
      now,
      3,
    );
    // Weeks ending 14, 7 and 0 days ago.
    expect(series).toEqual([1, 1, 2]);
  });

  it("compares the last 30 days with the 30 before", () => {
    const { changePercent } = tileTrend(
      [daysAgo(5), daysAgo(40), daysAgo(45)],
      now,
    );
    expect(changePercent).toBe(-50);
  });

  it("has no change figure without a base or without a change", () => {
    expect(tileTrend([daysAgo(5)], now).changePercent).toBeNull();
    expect(tileTrend([daysAgo(5), daysAgo(40)], now).changePercent).toBeNull();
  });
});
