import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  getResultsFreshness,
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
    baseRunStarted: null,
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
