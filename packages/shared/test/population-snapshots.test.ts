import { getDailyPopulationSnapshots } from "shared/populations";

function snapshot(id: string, asOf: string, status = "success") {
  return { id, asOf: new Date(asOf), status };
}

describe("getDailyPopulationSnapshots", () => {
  it("keeps the last successful snapshot of each UTC day, oldest first", () => {
    expect(
      getDailyPopulationSnapshots([
        snapshot("b", "2026-10-02T09:00:00Z"),
        snapshot("a", "2026-10-01T23:59:00Z"),
        snapshot("c", "2026-10-02T18:00:00Z"),
        snapshot("d", "2026-10-02T12:00:00Z"),
      ]).map((s) => s.id),
    ).toEqual(["a", "c"]);
  });

  it("skips snapshots that are running or failed", () => {
    expect(
      getDailyPopulationSnapshots([
        snapshot("ok", "2026-10-02T09:00:00Z"),
        snapshot("running", "2026-10-02T10:00:00Z", "running"),
        snapshot("failed", "2026-10-03T10:00:00Z", "error"),
      ]).map((s) => s.id),
    ).toEqual(["ok"]);
  });

  it("returns nothing for no snapshots", () => {
    expect(getDailyPopulationSnapshots([])).toEqual([]);
  });
});
