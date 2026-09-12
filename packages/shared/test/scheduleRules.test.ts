import { validateScheduleRules } from "shared/util";

// Accepts the same RFC 3339 set the API schemas do; canonical spelling is
// applied at write time (addIdsToFlatRules), not here.
describe("validateScheduleRules timestamps", () => {
  const pair = (start: string | null, end: string | null = null) => [
    { timestamp: start, enabled: true },
    { timestamp: end, enabled: false },
  ];

  it.each([
    ["canonical toISOString()", "2030-01-01T00:00:00.000Z"],
    ["second precision", "2030-01-01T00:00:00Z"],
    ["minute precision", "2030-01-01T00:00Z"],
    ["UTC offset", "2030-01-01T02:00:00+02:00"],
    ["negative offset with fraction", "2030-01-01T02:00:00.5-05:30"],
  ])("accepts %s", (_label, ts) => {
    expect(() => validateScheduleRules(pair(ts))).not.toThrow();
  });

  it.each([
    ["date only", "2030-01-01"],
    ["no zone designator", "2030-01-01T00:00:00"],
    ["prose", "next tuesday"],
    ["impossible date", "2030-13-45T00:00:00Z"],
  ])("rejects %s", (_label, ts) => {
    expect(() => validateScheduleRules(pair(ts))).toThrow(
      /Invalid timestamp format/,
    );
  });

  it("still enforces the pair shape", () => {
    expect(() => validateScheduleRules(pair(null))).toThrow(/null timestamp/);
    expect(() =>
      validateScheduleRules([{ timestamp: null, enabled: true }]),
    ).toThrow(/exactly 2/);
  });
});
