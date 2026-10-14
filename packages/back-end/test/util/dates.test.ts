import { assumeUtc } from "back-end/src/util/dates";

describe("assumeUtc", () => {
  it("reads a timezone-less date and time as UTC", () => {
    expect(new Date(assumeUtc("2026-01-15T08:12")).toISOString()).toBe(
      "2026-01-15T08:12:00.000Z",
    );
  });

  it("leaves a string with a timezone alone", () => {
    expect(assumeUtc("2026-01-15T08:12:00.000Z")).toBe(
      "2026-01-15T08:12:00.000Z",
    );
    expect(assumeUtc("2026-01-15T08:12:00+05:30")).toBe(
      "2026-01-15T08:12:00+05:30",
    );
    const d = new Date("2026-01-15T08:12:00.000Z");
    expect(assumeUtc(d)).toBe(d);
  });
});
