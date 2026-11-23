import {
  enumerateDateBucketsBetween,
  nextDateBucketStart,
  type ResolvedGranularity,
} from "shared/enterprise";
import { formatDateByGranularity } from "@/enterprise/components/ProductAnalytics/util";

// Roughly the room a rotated tick label needs.
const TICK_MIN_PX = 60;
// Tick cap used before the chart has been measured.
const DEFAULT_MAX_TICKS = 12;

/** ECharts settings for a date time axis, merged into the chart's own axis. */
export type DateTimeAxisOption = {
  axis: {
    min?: number;
    max?: number;
    // Also drives the split lines.
    axisTick: { customValues: number[] };
  };
  axisLabel: {
    customValues: number[];
    formatter: (value: number) => string;
  };
};

/**
 * Ticks and labels for a line/area chart's date time axis.
 *
 * Left alone, ECharts picks time-axis ticks without knowing the bucket size: a
 * single yearly bucket gets padded to a two-day window labelled in hours, and
 * coarse buckets get ticks between them. Instead:
 * - Ticks sit only on bucket starts, including buckets with no data, so a
 *   gap in the data still has ticks under it. When they don't fit, every Nth
 *   bucket is kept, counted back from the latest so the most recent period
 *   always has one.
 * - Every label uses one compact format. The year is left off only when every
 *   bucket is in the current year.
 * - A lone bucket gets an extent of half a bucket either side, so it sits
 *   centred under its one label.
 *
 * `bucketIsos` can be in any order; only the earliest and latest matter.
 */
export function buildDateTimeAxisOption({
  bucketIsos,
  granularity,
  plotWidth,
  now = Date.now(),
}: {
  bucketIsos: string[];
  granularity: ResolvedGranularity;
  plotWidth: number | null;
  now?: number;
}): DateTimeAxisOption {
  const times = enumerateDateBucketsBetween({
    resolvedGranularity: granularity,
    bucketIsos,
  });

  const maxTicks =
    plotWidth === null
      ? DEFAULT_MAX_TICKS
      : Math.max(2, Math.floor(plotWidth / TICK_MIN_PX));
  const stride = Math.max(1, Math.ceil(times.length / maxTicks));
  const last = times.length - 1;
  const tickValues = times.filter((_, i) => (last - i) % stride === 0);

  // Decided from every bucket, not just the ticks, so resizing the chart
  // can't add or drop the year.
  const currentYear = new Date(now).getUTCFullYear();
  const showYear = times.some(
    (t) => new Date(t).getUTCFullYear() !== currentYear,
  );

  const option: DateTimeAxisOption = {
    axis: { axisTick: { customValues: tickValues } },
    axisLabel: {
      customValues: tickValues,
      formatter: (value: number) =>
        formatDateByGranularity(new Date(value), granularity, "utc", {
          compact: true,
          showYear,
        }),
    },
  };

  if (times.length === 1) {
    const only = times[0];
    const half = (nextDateBucketStart(only, granularity) - only) / 2;
    option.axis.min = only - half;
    option.axis.max = only + half;
  }

  return option;
}
