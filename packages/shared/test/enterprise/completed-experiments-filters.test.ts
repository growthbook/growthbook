/// <reference types="jest" />

import { resolveCompletedExperimentsFilters } from "../../src/enterprise/validators/dashboard-block";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual: (expected: unknown) => void;
  toBe: (expected: unknown) => void;
  toBeCloseTo: (expected: number, precision?: number) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe("resolveCompletedExperimentsFilters", () => {
  it("resolves a predefined range to roughly [now - days, now]", () => {
    const { startDate, endDate, projects } = resolveCompletedExperimentsFilters(
      {
        dateRange: { predefined: "last90Days" },
        projects: ["prj_1"],
      },
    );
    const spanDays = (endDate.getTime() - startDate.getTime()) / DAY_MS;
    expect(Math.round(spanDays)).toEqual(90);
    expect(projects).toEqual(["prj_1"]);
  });

  it("resolves a custom lookback to that many days", () => {
    const { startDate, endDate } = resolveCompletedExperimentsFilters({
      dateRange: {
        predefined: "customLookback",
        lookbackValue: 45,
        lookbackUnit: "day",
      },
      projects: [],
    });
    const spanDays = (endDate.getTime() - startDate.getTime()) / DAY_MS;
    expect(Math.round(spanDays)).toEqual(45);
  });

  it("uses explicit start/end for a custom date range", () => {
    const { startDate, endDate } = resolveCompletedExperimentsFilters({
      dateRange: {
        predefined: "customDateRange",
        startDate: "2026-01-01",
        endDate: "2026-03-01",
      },
      projects: [],
    });
    // Custom ranges are expanded to full UTC days [00:00:00, 23:59:59.999].
    expect(startDate.toISOString()).toEqual("2026-01-01T00:00:00.000Z");
    expect(endDate.toISOString()).toEqual("2026-03-01T23:59:59.999Z");
  });

  it("lets a dashboard-level project filter override the block's projects", () => {
    const { projects } = resolveCompletedExperimentsFilters(
      { dateRange: { predefined: "last90Days" }, projects: ["prj_block"] },
      { projects: ["prj_dashboard"] },
    );
    expect(projects).toEqual(["prj_dashboard"]);
  });

  it("keeps the block's projects when the dashboard filter is empty", () => {
    const { projects } = resolveCompletedExperimentsFilters(
      { dateRange: { predefined: "last90Days" }, projects: ["prj_block"] },
      { projects: [] },
    );
    expect(projects).toEqual(["prj_block"]);
  });
});
