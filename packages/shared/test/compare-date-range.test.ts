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
    expect(out.startDate).toBe("2024-06-01");
    expect(out.endDate).toBe("2024-06-08");
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
    expect(out.startDate).toBe("2024-04-16");
    expect(out.endDate).toBe("2024-05-16");
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
    expect(out.startDate).toBe("2023-12-18");
    expect(out.endDate).toBe("2024-03-17");
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

  it("subtracts one year from customDateRange bounds", () => {
    const dr: ExplorationConfig["dateRange"] = {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    };

    const out = buildComparisonDateRange(dr);

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2025-01-01");
    expect(out.endDate).toBe("2025-02-01");
  });
});
