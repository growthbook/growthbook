import { getResultsFreshness } from "@/services/snapshots";

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
