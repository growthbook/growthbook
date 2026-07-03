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
  it("resolves a preset date range to roughly [now - days, now]", () => {
    const { startDate, endDate, projects } = resolveCompletedExperimentsFilters(
      {
        dateRange: "90",
        projects: ["prj_1"],
      },
    );
    const spanDays = (endDate.getTime() - startDate.getTime()) / DAY_MS;
    expect(Math.round(spanDays)).toEqual(90);
    expect(projects).toEqual(["prj_1"]);
  });

  it("falls back to 90 days for an unparseable preset", () => {
    const { startDate, endDate } = resolveCompletedExperimentsFilters({
      dateRange: "not-a-number",
      projects: [],
    });
    const spanDays = (endDate.getTime() - startDate.getTime()) / DAY_MS;
    expect(Math.round(spanDays)).toEqual(90);
  });

  it("uses explicit start/end for a custom range", () => {
    const { startDate, endDate } = resolveCompletedExperimentsFilters({
      dateRange: "custom",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-03-01T00:00:00.000Z",
      projects: [],
    });
    expect(startDate.toISOString()).toEqual("2026-01-01T00:00:00.000Z");
    expect(endDate.toISOString()).toEqual("2026-03-01T00:00:00.000Z");
  });

  it("lets a dashboard-level project filter override the block's projects", () => {
    const { projects } = resolveCompletedExperimentsFilters(
      { dateRange: "90", projects: ["prj_block"] },
      { projects: ["prj_dashboard"] },
    );
    expect(projects).toEqual(["prj_dashboard"]);
  });

  it("keeps the block's projects when the dashboard filter is empty", () => {
    const { projects } = resolveCompletedExperimentsFilters(
      { dateRange: "90", projects: ["prj_block"] },
      { projects: [] },
    );
    expect(projects).toEqual(["prj_block"]);
  });
});
