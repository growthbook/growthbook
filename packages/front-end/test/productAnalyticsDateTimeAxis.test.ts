import { describe, expect, it } from "vitest";
import { buildDateTimeAxisTicks } from "@/enterprise/components/ProductAnalytics/util";

const utc = (iso: string) => Date.parse(`${iso}Z`);

describe("buildDateTimeAxisTicks", () => {
  it("centres a single yearly bucket in a one-year window with one tick", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: ["2022-01-01 00:00:00"],
      granularity: "year",
      maxTicks: 12,
    });
    const jan1 = utc("2022-01-01T00:00:00");
    const halfYear = (utc("2023-01-01T00:00:00") - jan1) / 2;

    expect(result.tickValues).toEqual([jan1]);
    expect(result.labels.get(jan1)).toBe("2022");
    expect(result.min).toBe(jan1 - halfYear);
    expect(result.max).toBe(jan1 + halfYear);
  });

  it("pads a single daily bucket by half a day either side", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: ["2024-03-10T00:00:00.000Z"],
      granularity: "day",
      maxTicks: 12,
    });
    const day = utc("2024-03-10T00:00:00");
    expect(result.min).toBe(day - 12 * 60 * 60 * 1000);
    expect(result.max).toBe(day + 12 * 60 * 60 * 1000);
  });

  it("leaves the extent to ECharts when there are several buckets", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: ["2021-01-01", "2022-01-01", "2023-01-01"],
      granularity: "year",
      maxTicks: 12,
    });
    expect(result.min).toBeNull();
    expect(result.max).toBeNull();
    expect(result.tickValues).toEqual([
      Date.parse("2021-01-01"),
      Date.parse("2022-01-01"),
      Date.parse("2023-01-01"),
    ]);
    expect(Array.from(result.labels.values())).toEqual([
      "2021",
      "2022",
      "2023",
    ]);
  });

  it("only places ticks on bucket starts, sorted and de-duplicated", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: [
        "2025-03-01 00:00:00",
        "2025-01-01 00:00:00",
        "2025-02-01 00:00:00",
        "2025-01-01 00:00:00",
        "not a date",
      ],
      granularity: "month",
      maxTicks: 12,
    });
    expect(result.tickValues).toEqual([
      utc("2025-01-01T00:00:00"),
      utc("2025-02-01T00:00:00"),
      utc("2025-03-01T00:00:00"),
    ]);
  });

  it("thins ticks to at most maxTicks, keeping the first bucket", () => {
    const bucketIsos = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    );
    const result = buildDateTimeAxisTicks({
      bucketIsos,
      granularity: "day",
      maxTicks: 10,
    });
    // 30 buckets / 10 ticks → every 3rd bucket.
    expect(result.tickValues).toHaveLength(10);
    expect(result.tickValues[0]).toBe(Date.UTC(2025, 0, 1));
    expect(result.tickValues[1]).toBe(Date.UTC(2025, 0, 4));
  });

  it("shows the year on the first tick and where it changes", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: ["2024-11-01", "2024-12-01", "2025-01-01", "2025-02-01"],
      granularity: "month",
      maxTicks: 12,
    });
    const labels = result.tickValues.map((t) => result.labels.get(t) ?? "");
    expect(labels[0]).toContain("2024");
    expect(labels[1]).not.toContain("2024");
    expect(labels[2]).toContain("2025");
    expect(labels[3]).not.toContain("2025");
  });

  it("shows the date on hourly ticks only when the day changes", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: [
        "2025-06-01 22:00:00",
        "2025-06-01 23:00:00",
        "2025-06-02 00:00:00",
      ],
      granularity: "hour",
      maxTicks: 12,
    });
    const labels = result.tickValues.map((t) => result.labels.get(t) ?? "");
    expect(labels[0].length).toBeGreaterThan(labels[1].length);
    expect(labels[2].length).toBeGreaterThan(labels[1].length);
  });

  it("returns no ticks for no buckets", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: [],
      granularity: "day",
      maxTicks: 12,
    });
    expect(result.tickValues).toEqual([]);
    expect(result.min).toBeNull();
    expect(result.max).toBeNull();
  });
});
