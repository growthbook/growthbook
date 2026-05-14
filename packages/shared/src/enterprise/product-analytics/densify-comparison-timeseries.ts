import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import { calculateProductAnalyticsDateRange, getDateGranularity } from "./sql";
import { buildExplorationColumns, getIsRatioByIndex } from "./utils";

type ResolvedGranularity = "hour" | "day" | "week" | "month" | "year";

/**
 * UTC instant at the start of the `date_trunc` bucket for `dim0` (matches SQL in UTC).
 * Prefer this over {@link productAnalyticsDateDimensionMergeKey} when merging sparse
 * warehouse timestamps onto enumerated buckets.
 */
export function productAnalyticsDateDimensionBucketMergeKey(
  dim0: string | null,
  resolvedGranularity: ResolvedGranularity,
): number {
  if (dim0 == null) return NaN;
  const d = new Date(dim0);
  if (!Number.isFinite(d.getTime())) return NaN;
  return truncateUtc(d, resolvedGranularity).getTime();
}

/** UTC instant for stable merge / ordering of `dimensions[0]` strings from the warehouse. */
export function productAnalyticsDateDimensionMergeKey(
  dim0: string | null,
): number {
  if (dim0 == null) return NaN;
  return new Date(dim0).getTime();
}

function truncateUtc(d: Date, granularity: ResolvedGranularity): Date {
  const x = new Date(d.getTime());
  if (granularity === "hour") {
    x.setUTCMinutes(0, 0, 0);
    return x;
  }
  x.setUTCHours(0, 0, 0, 0);
  if (granularity === "day") {
    return x;
  }
  if (granularity === "week") {
    const dow = x.getUTCDay();
    const daysSinceMonday = (dow + 6) % 7;
    x.setUTCDate(x.getUTCDate() - daysSinceMonday);
    return x;
  }
  if (granularity === "month") {
    x.setUTCDate(1);
    return x;
  }
  x.setUTCMonth(0, 1);
  return x;
}

function stepBucketUtc(d: Date, granularity: ResolvedGranularity): void {
  switch (granularity) {
    case "hour":
      d.setUTCHours(d.getUTCHours() + 1);
      break;
    case "day":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    default: {
      const _exhaustive: never = granularity;
      throw new Error(`Unexpected granularity: ${_exhaustive}`);
    }
  }
}

/**
 * Every bucket start in `[rangeStart, rangeEnd]` inclusive, aligned to Postgres-style
 * `date_trunc` in UTC (week = Monday 00:00 UTC).
 */
export function enumerateProductAnalyticsDateBuckets(params: {
  resolvedGranularity: ResolvedGranularity;
  rangeStart: Date;
  rangeEnd: Date;
}): string[] {
  const { resolvedGranularity, rangeStart, rangeEnd } = params;
  const first = truncateUtc(rangeStart, resolvedGranularity);
  const last = truncateUtc(rangeEnd, resolvedGranularity);
  const out: string[] = [];
  for (
    let cur = new Date(first.getTime());
    cur.getTime() <= last.getTime();
    stepBucketUtc(cur, resolvedGranularity)
  ) {
    out.push(cur.toISOString());
  }
  return out;
}

function orderedMetricIdsForDensify(
  submittedConfig: ExplorationConfig,
  comparison: ProductAnalyticsExploration,
): string[] | null {
  const fromRow = comparison.result?.rows?.find(
    (r) => r.values?.length,
  )?.values;
  if (fromRow?.length) {
    return fromRow.map((v) => v.metricId);
  }
  if (submittedConfig.type === "metric") {
    const ids = submittedConfig.dataset.values
      .map((v) => v.metricId)
      .filter((id): id is string => Boolean(id));
    return ids.length ? ids : null;
  }
  return null;
}

function buildZeroValueRow(
  metricIds: string[],
  isRatioByIndex: boolean[],
): ProductAnalyticsResultRow["values"] {
  return metricIds.map((metricId, i) => {
    const isRatio = isRatioByIndex[i] ?? false;
    return {
      metricId,
      numerator: 0,
      denominator: isRatio ? 0 : null,
    };
  });
}

/**
 * Returns a clone of `comparison` whose `result.rows` include every date bucket in the
 * comparison window (zeros for gaps). Only supports a single date dimension (v1).
 */
export function densifyComparisonExplorationTimeseries(params: {
  comparison: ProductAnalyticsExploration | null;
  submittedConfig: ExplorationConfig;
  previousTimeFrame: ExplorationDateRange;
  getFactMetricById: (id: string) => FactMetricInterface | null;
}): ProductAnalyticsExploration | null {
  const { comparison, submittedConfig, previousTimeFrame, getFactMetricById } =
    params;

  if (!comparison) return null;

  const dims = submittedConfig.dimensions ?? [];
  if (dims.length !== 1 || dims[0].dimensionType !== "date") {
    return null;
  }

  const columns = buildExplorationColumns(submittedConfig, getFactMetricById);
  const hasAnyRatio = columns.some(
    (c) => c.kind === "metric" && c.sub !== "single",
  );
  if (hasAnyRatio) {
    return null;
  }

  const metricIds = orderedMetricIdsForDensify(submittedConfig, comparison);
  if (!metricIds?.length) {
    return null;
  }

  const dateDim = dims[0];
  const dr = calculateProductAnalyticsDateRange(previousTimeFrame);
  const resolved = getDateGranularity(dateDim.dateGranularity, dr);
  const bucketStrings = enumerateProductAnalyticsDateBuckets({
    resolvedGranularity: resolved,
    rangeStart: dr.startDate,
    rangeEnd: dr.endDate,
  });
  if (bucketStrings.length === 0) {
    return null;
  }

  const isRatioByIndex = getIsRatioByIndex(submittedConfig, getFactMetricById);
  const zeroValues = buildZeroValueRow(metricIds, isRatioByIndex);

  const byMergeKey = new Map<number, ProductAnalyticsResultRow>();
  for (const row of comparison.result?.rows ?? []) {
    const k = productAnalyticsDateDimensionBucketMergeKey(
      row.dimensions[0] ?? null,
      resolved,
    );
    if (!Number.isFinite(k)) continue;
    if (!byMergeKey.has(k)) {
      byMergeKey.set(k, row);
    }
  }

  const merged: ProductAnalyticsResultRow[] = bucketStrings.map((bucketIso) => {
    const k = productAnalyticsDateDimensionBucketMergeKey(bucketIso, resolved);
    const existing = byMergeKey.get(k);
    if (existing) {
      return existing;
    }
    return {
      dimensions: [bucketIso],
      values: zeroValues.map((v) => ({ ...v })),
    };
  });

  merged.sort(
    (a, b) =>
      productAnalyticsDateDimensionBucketMergeKey(
        a.dimensions[0] ?? null,
        resolved,
      ) -
      productAnalyticsDateDimensionBucketMergeKey(
        b.dimensions[0] ?? null,
        resolved,
      ),
  );

  return {
    ...comparison,
    result: {
      rows: merged,
    },
  };
}
