import {
  usesEventName,
  usesValueColumn,
} from "@/components/Metrics/MetricForm";

describe("metric SQL template variables", () => {
  it("returns false when SQL is omitted from a slim payload", () => {
    const slimFactTable: { sql?: string } = {};

    expect(usesEventName(slimFactTable.sql)).toBe(false);
    expect(usesValueColumn(slimFactTable.sql)).toBe(false);
  });

  it("detects supported template variables", () => {
    expect(
      usesEventName("SELECT * FROM events WHERE event = '{{ eventName }}'"),
    ).toBe(true);
    expect(usesValueColumn("SELECT {{ valueColumn }} AS value")).toBe(true);
  });

  it("returns false when the template variables are absent", () => {
    expect(usesEventName("SELECT event_name FROM events")).toBe(false);
    expect(usesValueColumn("SELECT value FROM events")).toBe(false);
  });
});
