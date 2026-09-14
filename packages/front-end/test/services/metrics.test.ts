import {
  formatDurationMilliseconds,
  formatDurationSeconds,
} from "@/services/metrics";

describe("formatDurationSeconds", () => {
  it("keeps the same unit for negative values as the matching positive", () => {
    expect(formatDurationSeconds(-2.5)).toBe("-2.5s");
    expect(formatDurationSeconds(2.5)).toBe("2.5s");
  });
});

describe("formatDurationMilliseconds", () => {
  it("does not keep raw milliseconds when the absolute value is at least one second", () => {
    expect(formatDurationMilliseconds(-2500)).toBe("-2.5s");
    expect(formatDurationMilliseconds(2500)).toBe("2.5s");
  });
});
