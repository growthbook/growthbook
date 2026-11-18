import { vi } from "vitest";
import { isAnalysisDateRangeOutdated } from "shared/experiments";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  getResultsFreshness,
  getSnapshotFreshnessInputs,
  refreshLacksSelectedAnalysis,
} from "@/services/snapshots";

describe("getResultsFreshness", () => {
  const ranAt = new Date("2026-10-20T12:00:00Z");

  it("returns null when the snapshot has not run", () => {
    expect(
      getResultsFreshness({ cutoffDate: new Date("2026-10-20T06:00:00Z") }),
    ).toBeNull();
  });

  it("dates a derived breakdown by its source's analysis end date", () => {
    const sourceEndDate = new Date("2026-10-19T00:00:00Z");
    expect(
      getResultsFreshness({
        dateCreated: ranAt,
        cutoffDate: new Date("2026-10-20T06:00:00Z"),
        sourceSnapshot: {
          id: "snp_overall",
          dateCreated: new Date("2026-10-19T08:00:00Z"),
          analysisEndDate: sourceEndDate,
        },
      }),
    ).toEqual({ kind: "derived", ranAt, asOf: sourceEndDate });
  });

  it("reports the cutoff a snapshot analyzed through", () => {
    const cutoffDate = new Date("2026-10-20T11:59:00Z");
    expect(getResultsFreshness({ dateCreated: ranAt, cutoffDate })).toEqual({
      kind: "cutoff",
      ranAt,
      asOf: cutoffDate,
    });
  });

  it("reports an update when there is no cutoff", () => {
    expect(getResultsFreshness({ dateCreated: ranAt })).toEqual({
      kind: "updated",
      ranAt,
    });
  });

  it("parses string dates", () => {
    expect(
      getResultsFreshness({
        dateCreated: "2026-10-20T12:00:00.000Z",
        cutoffDate: "2026-10-20T06:00:00.000Z",
      }),
    ).toEqual({
      kind: "cutoff",
      ranAt,
      asOf: new Date("2026-10-20T06:00:00Z"),
    });
  });
});

describe("getSnapshotFreshnessInputs", () => {
  const baseRanAt = new Date("2026-11-16T09:02:00Z");
  const refreshRanAt = new Date("2026-11-16T15:40:00Z");
  const freshnessOf = (
    snapshot: Parameters<typeof getSnapshotFreshnessInputs>[0],
  ) => getResultsFreshness(getSnapshotFreshnessInputs(snapshot));
  const lineage = (baseCutoffDate: Date | null) => ({
    baseSnapshotId: "snp_base",
    baseDateCreated: baseRanAt,
    baseCutoffDate,
    parentSnapshotId: "snp_base",
    metricIds: ["met_new"],
  });
  const fullRun = (endDate: Date, endDateIsCutoff: boolean) => ({
    type: "standard" as const,
    dateCreated: baseRanAt,
    settings: { endDate, endDateIsCutoff },
  });
  const refreshOf = (endDate: Date, baseCutoffDate: Date | null) => ({
    type: "standard" as const,
    dateCreated: refreshRanAt,
    settings: { endDate, endDateIsCutoff: true },
    metricRefresh: lineage(baseCutoffDate),
  });

  it("dates a refresh of a base without a cutoff by the base run", () => {
    const base = fullRun(baseRanAt, false);
    expect(freshnessOf(base)).toEqual({ kind: "updated", ranAt: baseRanAt });
    expect(freshnessOf(refreshOf(baseRanAt, null))).toEqual(freshnessOf(base));
  });

  it("keeps the base's cutoff for a refresh of a lagged base", () => {
    const baseCutoff = new Date("2026-11-16T06:00:00Z");
    const base = fullRun(baseCutoff, true);
    expect(freshnessOf(base)).toEqual({
      kind: "cutoff",
      ranAt: baseRanAt,
      asOf: baseCutoff,
    });
    expect(freshnessOf(refreshOf(baseCutoff, baseCutoff))).toEqual(
      freshnessOf(base),
    );
  });

  it("dates a refresh of a refresh by the root base", () => {
    const refreshOfRefresh = {
      ...refreshOf(baseRanAt, null),
      dateCreated: new Date("2026-11-16T18:00:00Z"),
    };
    expect(freshnessOf(refreshOfRefresh)).toEqual(
      freshnessOf(fullRun(baseRanAt, false)),
    );
  });

  it("parses the string dates a fetched snapshot carries", () => {
    const refresh = JSON.parse(JSON.stringify(refreshOf(baseRanAt, null)));
    expect(freshnessOf(refresh)).toEqual({ kind: "updated", ranAt: baseRanAt });
  });

  it("dates a dimension snapshot by its own run", () => {
    const dimension = {
      ...refreshOf(baseRanAt, null),
      type: "exploratory" as const,
    };
    expect(freshnessOf(dimension)).toEqual({
      kind: "cutoff",
      ranAt: refreshRanAt,
      asOf: baseRanAt,
    });
  });

  it("flags a refresh as outdated whenever its base would be", () => {
    const phase = { dateStarted: "2026-11-01T00:00:00Z" };
    const startDate = new Date(phase.dateStarted);
    const isOutdated = (
      snapshot: ReturnType<typeof fullRun> | ReturnType<typeof refreshOf>,
    ) =>
      isAnalysisDateRangeOutdated({
        phase,
        snapshotSettings: { ...snapshot.settings, startDate },
        snapshotDateCreated: getSnapshotFreshnessInputs(snapshot).dateCreated,
      });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
      expect(isOutdated(fullRun(baseRanAt, false))).toBe(true);
      expect(isOutdated(refreshOf(baseRanAt, null))).toBe(true);
      vi.setSystemTime(new Date("2026-11-16T20:00:00Z"));
      expect(isOutdated(fullRun(baseRanAt, false))).toBe(false);
      expect(isOutdated(refreshOf(baseRanAt, null))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("refreshLacksSelectedAnalysis", () => {
  const defaultSettings = {
    baselineVariationIndex: 0,
    differenceType: "relative",
    numGoalMetrics: 2,
  } as ExperimentSnapshotAnalysisSettings;
  const otherBaseline = {
    ...defaultSettings,
    baselineVariationIndex: 1,
    numGoalMetrics: 1,
  };
  const snapshotWith = (
    metricRefresh?: ExperimentSnapshotInterface["metricRefresh"],
  ) =>
    ({
      type: "standard",
      metricRefresh,
      analyses: [{ settings: defaultSettings }],
    }) as ExperimentSnapshotInterface;
  const refresh = {
    baseSnapshotId: "snp_base",
    baseDateCreated: new Date("2026-11-17T09:00:00Z"),
    baseCutoffDate: null,
    parentSnapshotId: "snp_base",
    metricIds: ["met_new"],
  };

  it("finds a refresh without the selected analysis", () => {
    expect(
      refreshLacksSelectedAnalysis(snapshotWith(refresh), otherBaseline),
    ).toBe(true);
  });

  it("finds nothing missing once the refresh has the selected analysis", () => {
    expect(
      refreshLacksSelectedAnalysis(snapshotWith(refresh), defaultSettings),
    ).toBe(false);
    expect(refreshLacksSelectedAnalysis(snapshotWith(refresh), null)).toBe(
      false,
    );
  });

  it("leaves a full update alone, which resets the selection itself", () => {
    expect(refreshLacksSelectedAnalysis(snapshotWith(), otherBaseline)).toBe(
      false,
    );
  });
});
