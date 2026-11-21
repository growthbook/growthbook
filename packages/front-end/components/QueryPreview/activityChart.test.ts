import { formatUtcWeekday, isRowCountStale } from "./activityChart";

describe("formatUtcWeekday", () => {
  it("reads warehouse timestamps as UTC days", () => {
    // 2026-09-21 is a Monday.
    expect(formatUtcWeekday("2026-09-21 00:00:00", "short")).toBe("Mon");
    expect(formatUtcWeekday("2026-09-21T00:00:00.000Z", "narrow")).toBe("M");
    expect(formatUtcWeekday("2026-09-21", "short")).toBe("Mon");
    expect(formatUtcWeekday("not a date", "short")).toBe("not a date");
  });
});

describe("isRowCountStale", () => {
  const run = {
    runStarted: new Date("2026-11-20T10:00:00Z"),
    dateUpdated: new Date("2026-11-20T10:05:00Z"),
  };

  it("is stale when the SQL changed after the run started", () => {
    expect(isRowCountStale(new Date("2026-11-20T11:00:00Z"), run)).toBe(true);
  });

  it("is stale when the SQL changed while the run was in progress", () => {
    expect(isRowCountStale(new Date("2026-11-20T10:02:00Z"), run)).toBe(true);
  });

  it("is fresh when the SQL changed before the run started", () => {
    expect(isRowCountStale(new Date("2026-11-20T09:00:00Z"), run)).toBe(false);
  });

  it("falls back to dateUpdated when runStarted is missing", () => {
    const old = { runStarted: null, dateUpdated: run.dateUpdated };
    expect(isRowCountStale(new Date("2026-11-20T10:02:00Z"), old)).toBe(false);
    expect(isRowCountStale(new Date("2026-11-20T10:06:00Z"), old)).toBe(true);
  });

  it("reads dates sent as JSON strings", () => {
    expect(isRowCountStale("2026-11-20T11:00:00.000Z", run)).toBe(true);
  });

  it("is fresh without counts or a recorded SQL change", () => {
    expect(isRowCountStale(new Date(), null)).toBe(false);
    expect(isRowCountStale(undefined, run)).toBe(false);
  });
});
