import {
  getResultsFreshness,
  getSnapshotFreshnessInputs,
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

  it("dates a refresh of a base without a cutoff by the base run", () => {
    const base = {
      dateCreated: baseRanAt,
      settings: { endDate: baseRanAt, endDateIsCutoff: false },
    };
    const refresh = {
      dateCreated: refreshRanAt,
      settings: { endDate: baseRanAt, endDateIsCutoff: true },
      metricRefresh: { baseDateCreated: baseRanAt, baseCutoffDate: null },
    };
    expect(freshnessOf(base)).toEqual({ kind: "updated", ranAt: baseRanAt });
    expect(freshnessOf(refresh)).toEqual(freshnessOf(base));
  });

  it("keeps the base's cutoff for a refresh of a lagged base", () => {
    const baseCutoff = new Date("2026-11-16T06:00:00Z");
    const base = {
      dateCreated: baseRanAt,
      settings: { endDate: baseCutoff, endDateIsCutoff: true },
    };
    const refresh = {
      dateCreated: refreshRanAt,
      settings: { endDate: baseCutoff, endDateIsCutoff: true },
      metricRefresh: { baseDateCreated: baseRanAt, baseCutoffDate: baseCutoff },
    };
    expect(freshnessOf(base)).toEqual({
      kind: "cutoff",
      ranAt: baseRanAt,
      asOf: baseCutoff,
    });
    expect(freshnessOf(refresh)).toEqual(freshnessOf(base));
  });

  it("dates a refresh of a refresh by the root base", () => {
    const base = {
      dateCreated: baseRanAt,
      settings: { endDate: baseRanAt, endDateIsCutoff: false },
    };
    const refreshOfRefresh = {
      dateCreated: new Date("2026-11-16T18:00:00Z"),
      settings: { endDate: baseRanAt, endDateIsCutoff: true },
      metricRefresh: { baseDateCreated: baseRanAt, baseCutoffDate: null },
    };
    expect(freshnessOf(refreshOfRefresh)).toEqual(freshnessOf(base));
  });

  it("parses the string dates a fetched snapshot carries", () => {
    const refresh = JSON.parse(
      JSON.stringify({
        dateCreated: refreshRanAt,
        settings: { endDate: baseRanAt, endDateIsCutoff: true },
        metricRefresh: { baseDateCreated: baseRanAt, baseCutoffDate: null },
      }),
    );
    expect(freshnessOf(refresh)).toEqual({ kind: "updated", ranAt: baseRanAt });
  });
});
