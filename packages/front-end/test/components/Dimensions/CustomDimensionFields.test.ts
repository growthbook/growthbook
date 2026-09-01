import {
  isCutoffWithinBounds,
  pickerDateToUtcInstant,
  utcInstantToPickerDate,
} from "@/components/Dimensions/CustomDimensionFields";

// These only mean anything when the runner is NOT on UTC; the suite sets
// TZ=America/Los_Angeles so the shift is observable.
describe("UTC picker conversions", () => {
  it("shows the instant's UTC wall-clock as the picker's local wall-clock", () => {
    const instant = new Date("2026-01-15T08:12:00.000Z");
    const picked = utcInstantToPickerDate(instant);

    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(0);
    expect(picked.getDate()).toBe(15);
    expect(picked.getHours()).toBe(8);
    expect(picked.getMinutes()).toBe(12);
  });

  it("reads the picker's local wall-clock back as a UTC instant", () => {
    const picked = new Date(2026, 0, 15, 8, 12);
    expect(pickerDateToUtcInstant(picked).toISOString()).toBe(
      "2026-01-15T08:12:00.000Z",
    );
  });

  it("round-trips in both directions", () => {
    const instant = new Date("2026-06-30T23:45:00.000Z");
    expect(
      pickerDateToUtcInstant(utcInstantToPickerDate(instant)).toISOString(),
    ).toBe(instant.toISOString());

    const picked = new Date(2026, 5, 30, 23, 45);
    const back = utcInstantToPickerDate(pickerDateToUtcInstant(picked));
    expect(back.getTime()).toBe(picked.getTime());
  });

  it("crosses the UTC date boundary rather than the local one", () => {
    // 5pm Jan 14 PST is Jan 15 01:00 UTC, so the picker must read Jan 15
    const instant = new Date("2026-01-15T01:00:00.000Z");
    expect(utcInstantToPickerDate(instant).getDate()).toBe(15);
  });
});

describe("isCutoffWithinBounds", () => {
  const min = new Date("2026-01-01T00:00:00.000Z");
  const max = new Date("2026-02-01T00:00:00.000Z");

  it("accepts an instant strictly inside the window", () => {
    expect(
      isCutoffWithinBounds(new Date("2026-01-15T00:00:00.000Z"), min, max),
    ).toBe(true);
  });

  it("rejects the boundaries and anything outside", () => {
    expect(isCutoffWithinBounds(min, min, max)).toBe(false);
    expect(isCutoffWithinBounds(max, min, max)).toBe(false);
    expect(
      isCutoffWithinBounds(new Date("2025-12-31T23:59:00.000Z"), min, max),
    ).toBe(false);
    expect(
      isCutoffWithinBounds(new Date("2026-02-01T00:01:00.000Z"), min, max),
    ).toBe(false);
  });

  it("treats missing bounds as unbounded", () => {
    expect(isCutoffWithinBounds(new Date("1999-01-01T00:00:00.000Z"))).toBe(
      true,
    );
  });
});
