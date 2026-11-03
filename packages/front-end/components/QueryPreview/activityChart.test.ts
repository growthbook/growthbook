import { formatUtcWeekday } from "./activityChart";

describe("formatUtcWeekday", () => {
  it("reads warehouse timestamps as UTC days", () => {
    // 2026-09-21 is a Monday.
    expect(formatUtcWeekday("2026-09-21 00:00:00", "short")).toBe("Mon");
    expect(formatUtcWeekday("2026-09-21T00:00:00.000Z", "narrow")).toBe("M");
    expect(formatUtcWeekday("2026-09-21", "short")).toBe("Mon");
    expect(formatUtcWeekday("not a date", "short")).toBe("not a date");
  });
});
