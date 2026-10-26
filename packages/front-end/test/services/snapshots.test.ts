import { getResultsFreshness } from "@/services/snapshots";

describe("getResultsFreshness", () => {
  const ranAt = new Date("2026-10-20T12:00:00Z");

  it("returns null when the snapshot has not run", () => {
    expect(
      getResultsFreshness({
        analysisEndDate: new Date("2026-10-20T06:00:00Z"),
      }),
    ).toBeNull();
  });

  it("dates a derived breakdown by its source's analysis end date", () => {
    const sourceEndDate = new Date("2026-10-19T00:00:00Z");
    expect(
      getResultsFreshness({
        dateCreated: ranAt,
        analysisEndDate: ranAt,
        sourceSnapshot: {
          id: "snp_overall",
          dateCreated: new Date("2026-10-19T08:00:00Z"),
          analysisEndDate: sourceEndDate,
        },
      }),
    ).toEqual({ kind: "derived", ranAt, asOf: sourceEndDate });
  });

  it("reports a cutoff when the end date is at least a minute before the run", () => {
    const endDate = new Date("2026-10-20T11:59:00Z");
    expect(
      getResultsFreshness({ dateCreated: ranAt, analysisEndDate: endDate }),
    ).toEqual({ kind: "cutoff", ranAt, asOf: endDate });
  });

  it("reports an update when the end date is within a minute of the run", () => {
    expect(
      getResultsFreshness({
        dateCreated: ranAt,
        analysisEndDate: new Date("2026-10-20T11:59:00.001Z"),
      }),
    ).toEqual({ kind: "updated", ranAt });
  });

  it("reports an update when there is no end date", () => {
    expect(getResultsFreshness({ dateCreated: ranAt })).toEqual({
      kind: "updated",
      ranAt,
    });
  });

  it("keeps a stopped phase on its run time", () => {
    expect(
      getResultsFreshness({
        dateCreated: ranAt,
        analysisEndDate: new Date("2026-09-01T00:00:00Z"),
        phaseEnded: true,
      }),
    ).toEqual({ kind: "updated", ranAt });
  });

  it("parses string dates", () => {
    expect(
      getResultsFreshness({
        dateCreated: "2026-10-20T12:00:00.000Z",
        analysisEndDate: "2026-10-20T06:00:00.000Z",
      }),
    ).toEqual({
      kind: "cutoff",
      ranAt,
      asOf: new Date("2026-10-20T06:00:00Z"),
    });
  });
});
