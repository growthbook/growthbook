import { localAsUtc, utcAsLocal } from "@/utils/date";

// These only mean anything when the runner is NOT on UTC; the suite sets
// TZ=America/Los_Angeles so the shift is observable.
describe("UTC picker conversions", () => {
  it("shows a UTC date and time as the same local date and time", () => {
    const utc = new Date("2026-01-15T08:12:00.000Z");
    const picked = utcAsLocal(utc);

    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(0);
    expect(picked.getDate()).toBe(15);
    expect(picked.getHours()).toBe(8);
    expect(picked.getMinutes()).toBe(12);
  });

  it("reads a local date and time back as the same UTC date and time", () => {
    const picked = new Date(2026, 0, 15, 8, 12);
    expect(localAsUtc(picked).toISOString()).toBe("2026-01-15T08:12:00.000Z");
  });

  it("round-trips in both directions", () => {
    const utc = new Date("2026-06-30T23:45:00.000Z");
    expect(localAsUtc(utcAsLocal(utc)).toISOString()).toBe(utc.toISOString());

    const picked = new Date(2026, 5, 30, 23, 45);
    const back = utcAsLocal(localAsUtc(picked));
    expect(back.getTime()).toBe(picked.getTime());
  });

  it("keeps seconds and milliseconds so bounds stay exact", () => {
    const utc = new Date("2026-06-30T12:30:45.123Z");
    expect(localAsUtc(utcAsLocal(utc)).toISOString()).toBe(utc.toISOString());
  });

  it("crosses the UTC date boundary rather than the local one", () => {
    // 5pm Jan 14 PST is Jan 15 01:00 UTC, so the picker must read Jan 15
    const utc = new Date("2026-01-15T01:00:00.000Z");
    expect(utcAsLocal(utc).getDate()).toBe(15);
  });
});
