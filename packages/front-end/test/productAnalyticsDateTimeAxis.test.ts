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

  it("labels every tick without the year when all are in the current year", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: ["2026-10-25", "2026-11-01"],
      granularity: "week",
      maxTicks: 12,
      now: Date.UTC(2026, 10, 19),
    });
    const labels = result.tickValues.map((t) => result.labels.get(t) ?? "");
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label).not.toContain("2026");
  });

  it("labels every tick with the year when any is outside the current year", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"],
      granularity: "month",
      maxTicks: 12,
      now: Date.UTC(2026, 10, 19),
    });
    const labels = result.tickValues.map((t) => result.labels.get(t) ?? "");
    expect(labels[0]).toContain("2025");
    expect(labels[1]).toContain("2025");
    expect(labels[2]).toContain("2026");
    expect(labels[3]).toContain("2026");
  });

  it("labels a past year's ticks with the year even within one year", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: ["2024-03-04", "2024-03-11"],
      granularity: "day",
      maxTicks: 12,
      now: Date.UTC(2026, 10, 19),
    });
    for (const t of result.tickValues) {
      expect(result.labels.get(t)).toContain("2024");
    }
  });

  it("gives hourly ticks the same date-and-time format throughout", () => {
    const result = buildDateTimeAxisTicks({
      bucketIsos: [
        "2026-06-01 22:00:00",
        "2026-06-01 23:00:00",
        "2026-06-02 00:00:00",
      ],
      granularity: "hour",
      maxTicks: 12,
      now: Date.UTC(2026, 10, 19),
    });
    const labels = result.tickValues.map((t) => result.labels.get(t) ?? "");
    // Each label carries its date, not just the first or day-change ticks.
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0].slice(0, 5)).toBe(labels[1].slice(0, 5));
    expect(labels[1].slice(0, 5)).not.toBe(labels[2].slice(0, 5));
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
