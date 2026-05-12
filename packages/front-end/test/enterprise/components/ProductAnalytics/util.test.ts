import { describe, expect, it } from "vitest";
import { formatCompactNumber } from "@/enterprise/components/ProductAnalytics/util";

describe("formatCompactNumber", () => {
  it("formats values below 1K with locale-aware grouping", () => {
    expect(formatCompactNumber(500)).toBe("500");
    expect(formatCompactNumber(123.456)).toBe("123.46");
  });

  it("formats thousands with one decimal place", () => {
    expect(formatCompactNumber(1_500)).toBe("1.5K");
    expect(formatCompactNumber(1_000)).toBe("1.0K");
  });

  it("formats millions with two decimal places", () => {
    expect(formatCompactNumber(2_500_000)).toBe("2.50M");
    expect(formatCompactNumber(1_000_000)).toBe("1.00M");
  });

  it("uses absolute value thresholds for negative numbers", () => {
    expect(formatCompactNumber(-2_500)).toBe("-2.5K");
    expect(formatCompactNumber(-3_200_000)).toBe("-3.20M");
  });
});
