import { buildComparisonDateRange } from "shared/enterprise";
import type { ExplorationConfig } from "shared/validators";

describe("buildComparisonDateRange", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shifts last7Days to the contiguous prior window", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "last7Days",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2024-05-31");
    expect(out.endDate).toBe("2024-06-07");
  });

  it("shifts last30Days to the contiguous prior window", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "last30Days",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2024-04-15");
    expect(out.endDate).toBe("2024-05-15");
  });

  it("shifts custom lookback by one span", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "customLookback",
      lookbackValue: 90,
      lookbackUnit: "day",
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2023-12-17");
    expect(out.endDate).toBe("2024-03-16");
    expect(out.lookbackValue).toBe(90);
    expect(out.lookbackUnit).toBe("day");
  });

  it("maps today to previous UTC calendar day", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "today",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2024-06-14");
    expect(out.endDate).toBe("2024-06-14");
  });

  it("maps customDateRange to the contiguous prior window (equal inclusive UTC days)", () => {
    const dr: ExplorationConfig["dateRange"] = {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    };

    const out = buildComparisonDateRange(dr);

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2025-11-30");
    expect(out.endDate).toBe("2025-12-31");
  });

  it("uses abutting prior range for customDateRange (Feb 1–5 → Jan 27–31)", () => {
    const dr: ExplorationConfig["dateRange"] = {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: "2026-02-01",
      endDate: "2026-02-05",
    };

    const out = buildComparisonDateRange(dr);

    expect(out.startDate).toBe("2026-01-27");
    expect(out.endDate).toBe("2026-01-31");
  });

  it("preserves lookback from customDateRange when using contiguous prior window", () => {
    const dr: ExplorationConfig["dateRange"] = {
      predefined: "customDateRange",
      lookbackValue: 30,
      lookbackUnit: "day",
      startDate: "2026-05-13",
      endDate: "2026-05-22",
    };

    const out = buildComparisonDateRange(dr);

    expect(out.predefined).toBe("customDateRange");
    expect(out.lookbackValue).toBe(30);
    expect(out.lookbackUnit).toBe("day");
    expect(out.startDate).toBe("2026-05-03");
    expect(out.endDate).toBe("2026-05-12");
  });
});
