import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  entirePhaseRange,
  getPhaseBounds,
  phaseLast24Hours,
  rangeExceedsPhase,
} from "@/components/HealthTab/exposurePhaseRange";

const running = getPhaseBounds({ dateStarted: "2026-10-10T08:00:00.000Z" });
const ended = getPhaseBounds({
  dateStarted: "2026-10-01T08:00:00.000Z",
  dateEnded: "2026-10-10T08:00:00.000Z",
});

describe("exposurePhaseRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("defaults to a plain lookback while the phase runs", () => {
    expect(phaseLast24Hours(running)).toEqual({
      predefined: "customLookback",
      lookbackValue: 24,
      lookbackUnit: "hour",
    });
  });

  it("defaults to the day before the end once the phase has stopped", () => {
    expect(phaseLast24Hours(ended)).toEqual({
      predefined: "customDateRange",
      startDate: "2026-10-09",
      endDate: "2026-10-10",
    });
  });

  it("never reaches before the phase start for a short phase", () => {
    const short = getPhaseBounds({
      dateStarted: "2026-10-10T06:00:00.000Z",
      dateEnded: "2026-10-10T08:00:00.000Z",
    });
    expect(phaseLast24Hours(short).startDate).toBe("2026-10-10");
  });

  it("spans the whole phase, up to now while running", () => {
    expect(entirePhaseRange(ended)).toEqual({
      predefined: "customDateRange",
      startDate: "2026-10-01",
      endDate: "2026-10-10",
    });
    expect(entirePhaseRange(running)?.endDate).toBe("2026-10-15");
  });

  it("flags a lookback that reaches before the phase start", () => {
    expect(
      rangeExceedsPhase(
        { predefined: "customLookback", lookbackValue: 7, lookbackUnit: "day" },
        running,
      ),
    ).toBe(true);
    expect(
      rangeExceedsPhase(
        {
          predefined: "customLookback",
          lookbackValue: 24,
          lookbackUnit: "hour",
        },
        running,
      ),
    ).toBe(false);
  });

  it("flags a lookback that runs past an ended phase", () => {
    expect(
      rangeExceedsPhase(
        {
          predefined: "customLookback",
          lookbackValue: 24,
          lookbackUnit: "hour",
        },
        ended,
      ),
    ).toBe(true);
  });

  it("flags a lookback on a phase younger than the lookback", () => {
    const young = getPhaseBounds({ dateStarted: "2026-10-15T10:00:00.000Z" });
    expect(rangeExceedsPhase(phaseLast24Hours(young), young)).toBe(true);
  });

  it("compares custom ranges on timestamps, so day rounding past a mid-day phase end is flagged", () => {
    // The ended phase stops at 08:00 on Oct 10; the reset covers Oct 9-10 as
    // whole days, so it reaches into whatever ran later on Oct 10.
    expect(rangeExceedsPhase(phaseLast24Hours(ended), ended)).toBe(true);
    const whole = entirePhaseRange(ended);
    expect(whole && rangeExceedsPhase(whole, ended)).toBe(true);
  });

  it("does not flag a custom range inside the phase", () => {
    expect(
      rangeExceedsPhase(
        {
          predefined: "customDateRange",
          startDate: "2026-10-03",
          endDate: "2026-10-05",
        },
        ended,
      ),
    ).toBe(false);
  });
});
