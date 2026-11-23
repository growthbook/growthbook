import { describe, expect, it } from "vitest";
import { buildDateTimeAxisOption } from "@/enterprise/components/ProductAnalytics/dateTimeAxis";
import { formatDateByGranularity } from "@/enterprise/components/ProductAnalytics/util";

const NOW = Date.UTC(2026, 10, 19);
const DAY_MS = 24 * 60 * 60 * 1000;

// Some locales add a suffix to a bare year ("2022年").
function yearLabel(year: number) {
  return new Date(Date.UTC(year, 0, 1)).toLocaleDateString(undefined, {
    year: "numeric",
    timeZone: "UTC",
  });
}

function build(
  bucketIsos: string[],
  granularity: Parameters<typeof buildDateTimeAxisOption>[0]["granularity"],
  plotWidth: number | null = null,
) {
  const option = buildDateTimeAxisOption({
    bucketIsos,
    granularity,
    plotWidth,
    now: NOW,
  });
  const ticks = option.axis.axisTick.customValues;
  return {
    option,
    ticks,
    labels: ticks.map((t) => option.axisLabel.formatter(t)),
  };
}

describe("buildDateTimeAxisOption", () => {
  it("centres a single yearly bucket in a one-year window with one tick", () => {
    const { option, ticks, labels } = build(["2022-01-01 00:00:00"], "year");
    const jan1 = Date.UTC(2022, 0, 1);
    const halfYear = (Date.UTC(2023, 0, 1) - jan1) / 2;

    expect(ticks).toEqual([jan1]);
    expect(option.axisLabel.customValues).toEqual([jan1]);
    expect(labels).toEqual([yearLabel(2022)]);
    expect(option.axis.min).toBe(jan1 - halfYear);
    expect(option.axis.max).toBe(jan1 + halfYear);
  });

  it("pads a single daily bucket by half a day either side", () => {
    const { option } = build(["2024-03-10T00:00:00.000Z"], "day");
    const day = Date.UTC(2024, 2, 10);
    expect(option.axis.min).toBe(day - DAY_MS / 2);
    expect(option.axis.max).toBe(day + DAY_MS / 2);
  });

  it("pads a single week by half a week either side", () => {
    const { option } = build(["2026-11-02 00:00:00"], "week");
    const monday = Date.UTC(2026, 10, 2);
    expect(option.axis.min).toBe(monday - 3.5 * DAY_MS);
    expect(option.axis.max).toBe(monday + 3.5 * DAY_MS);
  });

  it("leaves the extent to ECharts when there are several buckets", () => {
    const { option, labels } = build(
      ["2021-01-01", "2022-01-01", "2023-01-01"],
      "year",
    );
    expect(option.axis).not.toHaveProperty("min");
    expect(option.axis).not.toHaveProperty("max");
    expect(labels).toEqual([2021, 2022, 2023].map(yearLabel));
  });

  it("only places ticks on valid bucket starts", () => {
    const { ticks } = build(
      ["2026-01-01 00:00:00", "not a date", "2026-02-01 00:00:00"],
      "month",
    );
    expect(ticks).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)]);
  });

  it("spans the earliest to latest bucket even if the input is out of order", () => {
    const { option, ticks } = build(
      ["2026-03-01 00:00:00", "2026-01-01 00:00:00", "2026-02-01 00:00:00"],
      "month",
    );
    expect(ticks).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 1, 1),
      Date.UTC(2026, 2, 1),
    ]);
    expect(option.axis).not.toHaveProperty("min");
  });

  it("ticks every point of a weekly series extended for a comparison", () => {
    // Two warehouse weeks, plus two more added because the comparison window
    // is longer (see extendDateBucketsForward).
    const { ticks } = build(
      [
        "2026-11-02 00:00:00",
        "2026-11-09 00:00:00",
        "2026-11-16T00:00:00.000Z",
        "2026-11-23T00:00:00.000Z",
      ],
      "week",
    );
    expect(ticks).toEqual([
      Date.UTC(2026, 10, 2),
      Date.UTC(2026, 10, 9),
      Date.UTC(2026, 10, 16),
      Date.UTC(2026, 10, 23),
    ]);
  });

  it("puts ticks under gaps in the data", () => {
    // Hourly data on Jul 25 08:00–10:00, then nothing until Jul 26 08:00.
    const { ticks } = build(
      [
        "2022-07-25 08:00:00",
        "2022-07-25 09:00:00",
        "2022-07-25 10:00:00",
        "2022-07-26 08:00:00",
      ],
      "hour",
    );
    const HOUR_MS = 60 * 60 * 1000;
    // 25 hourly buckets thinned to 12 ticks → every 3rd hour, back from the
    // last, so ticks land inside the overnight gap.
    const gapStart = Date.UTC(2022, 6, 25, 10);
    const gapEnd = Date.UTC(2022, 6, 26, 8);
    expect(ticks.filter((t) => t > gapStart && t < gapEnd)).toHaveLength(7);
    expect(ticks[ticks.length - 1]).toBe(gapEnd);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBe(3 * HOUR_MS);
    }
  });

  it("thins ticks to fit the plot width, keeping the latest bucket", () => {
    const bucketIsos = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    );
    // 600px / 60px per tick → at most 10 ticks → every 3rd bucket, counted
    // back from Jan 30.
    const { ticks } = build(bucketIsos, "day", 600);
    expect(ticks).toHaveLength(10);
    expect(ticks[9]).toBe(Date.UTC(2025, 0, 30));
    expect(ticks[8]).toBe(Date.UTC(2025, 0, 27));
    expect(ticks[0]).toBe(Date.UTC(2025, 0, 3));
  });

  it("leaves the year off every label when all buckets are in the current year", () => {
    const { labels } = build(["2026-10-25", "2026-11-01"], "week");
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label).not.toContain("2026");
  });

  it("puts the year on every label when any bucket is outside the current year", () => {
    const { labels } = build(
      ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"],
      "month",
    );
    expect(labels[0]).toContain("2025");
    expect(labels[1]).toContain("2025");
    expect(labels[2]).toContain("2026");
    expect(labels[3]).toContain("2026");
  });

  it("decides the year from every bucket, so thinning can't change it", () => {
    // Weekly buckets from late 2025 into 2026. Narrow enough that the 2025
    // buckets get no tick, but they still make every label show the year.
    const bucketIsos = Array.from({ length: 12 }, (_, i) =>
      new Date(Date.UTC(2025, 11, 22 + 7 * i)).toISOString(),
    );
    const wide = build(bucketIsos, "week", 1200);
    const narrow = build(bucketIsos, "week", 120);
    expect(
      narrow.ticks.every((t) => new Date(t).getUTCFullYear() === 2026),
    ).toBe(true);
    for (const label of [...wide.labels, ...narrow.labels]) {
      expect(label).toMatch(/2025|2026/);
    }
  });

  it("gives hourly ticks the same date-and-time format throughout", () => {
    const { labels } = build(
      ["2026-06-01 22:00:00", "2026-06-01 23:00:00", "2026-06-02 00:00:00"],
      "hour",
    );
    // Every label carries its date, not just the first or day-change ticks.
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0].slice(0, 5)).toBe(labels[1].slice(0, 5));
    expect(labels[1].slice(0, 5)).not.toBe(labels[2].slice(0, 5));
  });

  it("returns no ticks for no buckets", () => {
    const { option, ticks } = build([], "day");
    expect(ticks).toEqual([]);
    expect(option.axis).not.toHaveProperty("min");
  });
});

describe("formatDateByGranularity compact style", () => {
  const nov2 = new Date(Date.UTC(2026, 10, 2));

  it("drops the week prefix and keeps it in the default style", () => {
    expect(formatDateByGranularity(nov2, "week")).toMatch(/^Week of /);
    expect(
      formatDateByGranularity(nov2, "week", "utc", { compact: true }),
    ).not.toMatch(/^Week of /);
  });

  it("omits the year only when asked", () => {
    expect(
      formatDateByGranularity(nov2, "day", "utc", {
        compact: true,
        showYear: false,
      }),
    ).not.toContain("2026");
    expect(
      formatDateByGranularity(nov2, "day", "utc", { compact: true }),
    ).toContain("2026");
  });

  it("gives hourly ticks the date on every label, without minutes on a 12-hour clock", () => {
    const nineAm = new Date(Date.UTC(2022, 6, 25, 9));
    const label = formatDateByGranularity(nineAm, "hour", "utc", {
      compact: true,
      showYear: false,
    });
    // Compared with Intl directly: string lengths vary by locale.
    const hour12 = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
    }).resolvedOptions().hour12;
    expect(label).toBe(
      nineAm.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        ...(hour12 ? {} : { minute: "2-digit" as const }),
        timeZone: "UTC",
      }),
    );
    if (Intl.DateTimeFormat().resolvedOptions().locale === "en-US") {
      expect(label).toBe("Jul 25, 9 AM");
      expect(
        formatDateByGranularity(nineAm, "hour", "utc", { compact: true }),
      ).toBe("Jul 25, 2022, 9 AM");
    }
  });

  it("uses a short month name instead of the long one", () => {
    // Compared with Intl directly: in some locales (ja-JP, zh-CN) the short
    // and long month names are the same, so lengths prove nothing.
    expect(
      formatDateByGranularity(nov2, "month", "utc", { compact: true }),
    ).toBe(
      nov2.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    );
    expect(formatDateByGranularity(nov2, "month")).toBe(
      nov2.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
    );
  });
});
