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

  it("handles second-precision datetime by appending Z", () => {
    expect(assumeUtc("2026-01-15T08:12:30")).toBe("2026-01-15T08:12:30Z");
    expect(new Date(assumeUtc("2026-01-15T08:12:30")).toISOString()).toBe(
      "2026-01-15T08:12:30.000Z",
    );
  });

  it("handles fractional seconds by appending Z", () => {
    expect(assumeUtc("2026-01-15T08:12:30.123")).toBe(
      "2026-01-15T08:12:30.123Z",
    );
    expect(new Date(assumeUtc("2026-01-15T08:12:30.123")).toISOString()).toBe(
      "2026-01-15T08:12:30.123Z",
    );
  });

  it("handles date-only by appending full time and Z", () => {
    expect(assumeUtc("2026-01-15")).toBe("2026-01-15T00:00:00Z");
    expect(new Date(assumeUtc("2026-01-15")).toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
  });

  it("preserves minute precision behavior with :00Z suffix", () => {
    expect(assumeUtc("2026-01-15T08:12")).toBe("2026-01-15T08:12:00Z");
  });
});
