import { formatTimestamp, truncate } from "@/components/Diagnostics/format";

describe("formatTimestamp", () => {
  it("returns the input unchanged when it cannot be parsed", () => {
    expect(formatTimestamp("not a date")).toBe("not a date");
    expect(formatTimestamp("2025-13-45T99:99:99Z")).toBe(
      "2025-13-45T99:99:99Z",
    );
    // A record whose warehouse timestamp was null shapes to "".
    expect(formatTimestamp("")).toBe("");
  });

  it("renders a parseable timestamp down to the second", () => {
    const out = formatTimestamp("2026-10-13T13:23:45.000Z");
    expect(out).not.toBe("2026-10-13T13:23:45.000Z");
    // Locale and zone belong to the viewer, so assert the shape rather than a
    // fixed string: a clock time carrying both minutes and seconds.
    expect(out).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("formats the same instant identically however it is spelled", () => {
    expect(formatTimestamp("2026-10-13T13:23:45.000Z")).toBe(
      formatTimestamp("2026-10-13T15:23:45.000+02:00"),
    );
  });
});

describe("truncate", () => {
  it("leaves a value at or below the limit alone", () => {
    expect(truncate("abcd", 5)).toBe("abcd");
    expect(truncate("abcde", 5)).toBe("abcde");
    expect(truncate("", 5)).toBe("");
  });

  it("cuts to the limit and marks the cut", () => {
    expect(truncate("abcdef", 5)).toBe("abcde…");
    // The ellipsis sits outside the limit, so the result runs one over it.
    expect(truncate("abcdef", 5)).toHaveLength(6);
  });

  it("handles a zero limit", () => {
    expect(truncate("abc", 0)).toBe("…");
    expect(truncate("", 0)).toBe("");
  });
});
