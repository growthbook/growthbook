import { formatTimestamp } from "@/components/Diagnostics/format";

describe("formatTimestamp", () => {
  it("preserves invalid warehouse values", () => {
    expect(formatTimestamp("not a date")).toBe("not a date");
    expect(formatTimestamp("2025-13-45T99:99:99Z")).toBe(
      "2025-13-45T99:99:99Z",
    );
    expect(formatTimestamp("")).toBe("");
  });

  it("renders valid timestamps in UTC down to the second", () => {
    expect(formatTimestamp("2026-10-13T15:23:45.000+02:00")).toBe(
      "2026-10-13 13:23:45",
    );
  });
});
