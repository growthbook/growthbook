import { getDefinitionMetricId } from "shared/experiments";
import { BASE_COLUMNS_PER_QUERY, MAX_METRICS_PER_QUERY } from "./constants";

/**
 * One metric in one kind of cache. A cache kind is a fact table, or its
 * quantile or cluster-level caches; a metric over two fact tables is one entry
 * in each of their kinds.
 */
export type CacheMetric = {
  metricId: string;
  cacheKind: string;
  columns: number;
};

export type StoredCache = {
  groupId: string;
  cacheKind: string;
  metrics: CacheMetric[];
};

/** A cache this run builds: a stored cache extended with metrics, or a new one. */
export type PlannedCache = {
  cacheKind: string;
  replacesGroupId: string | null;
  metricIds: string[];
};

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order metrics are placed and listed in: larger metrics first, then by
 * definition so a metric sits next to its slices. List position never counts,
 * so reordering an experiment's metrics can't change its caches.
 */
export function compareCacheMetrics(a: CacheMetric, b: CacheMetric): number {
  return (
    compareStrings(a.cacheKind, b.cacheKind) ||
    b.columns - a.columns ||
    compareStrings(
      getDefinitionMetricId(a.metricId),
      getDefinitionMetricId(b.metricId),
    ) ||
    compareStrings(a.metricId, b.metricId)
  );
}

/**
 * Places each metric in the cache of its kind that uses the fewest columns and
 * still has room, opening a new cache when none has. Stored caches that take
 * no metric are left out of the result, so they keep their tables and the
 * queries that read them. Ties go to a cache this run builds anyway, so a tie
 * never rebuilds another, then to the cache with fewer metrics, then to one
 * already joined with a cache holding another side of the same metric, then
 * to the earliest stored group id.
 */
export function planIncrementalCaches({
  metrics,
  storedCaches,
  maxColumns,
}: {
  metrics: CacheMetric[];
  storedCaches: StoredCache[];
  maxColumns: number;
}): PlannedCache[] {
  type Cache = {
    order: number;
    cacheKind: string;
    replacesGroupId: string | null;
    metrics: CacheMetric[];
    columns: number;
    built: boolean;
  };
  const caches: Cache[] = [...storedCaches]
    .sort((a, b) => compareStrings(a.groupId, b.groupId))
    .map((stored, order) => ({
      order,
      cacheKind: stored.cacheKind,
      replacesGroupId: stored.groupId,
      metrics: [...stored.metrics],
      columns: stored.metrics.reduce((sum, m) => sum + m.columns, 0),
      built: false,
    }));

  const cachesByMetricId = new Map<string, Cache[]>();
  const addToCache = (cache: Cache, metric: CacheMetric) => {
    cache.metrics.push(metric);
    cache.columns += metric.columns;
    cachesByMetricId.set(metric.metricId, [
      ...(cachesByMetricId.get(metric.metricId) ?? []),
      cache,
    ]);
  };
  caches.forEach((cache) =>
    cache.metrics.forEach((m) =>
      cachesByMetricId.set(m.metricId, [
        ...(cachesByMetricId.get(m.metricId) ?? []),
        cache,
      ]),
    ),
  );

  for (const metric of [...metrics].sort(compareCacheMetrics)) {
    const otherSides = cachesByMetricId.get(metric.metricId) ?? [];
    const joinsOtherSide = (cache: Cache) =>
      [...cachesByMetricId].some(
        ([metricId, holders]) =>
          metricId !== metric.metricId &&
          holders.includes(cache) &&
          holders.some((holder) => otherSides.includes(holder)),
      );
    const compareCandidates = (a: Cache, b: Cache) =>
      a.columns - b.columns ||
      Number(b.built) - Number(a.built) ||
      a.metrics.length - b.metrics.length ||
      Number(joinsOtherSide(b)) - Number(joinsOtherSide(a)) ||
      a.order - b.order;

    const fitting = caches.filter(
      (cache) =>
        cache.cacheKind === metric.cacheKind &&
        BASE_COLUMNS_PER_QUERY + cache.columns + metric.columns <= maxColumns &&
        cache.metrics.length < MAX_METRICS_PER_QUERY,
    );
    let target = fitting.sort(compareCandidates)[0];
    if (!target) {
      target = {
        order: caches.length,
        cacheKind: metric.cacheKind,
        replacesGroupId: null,
        metrics: [],
        columns: 0,
        built: true,
      };
      caches.push(target);
    }
    target.built = true;
    addToCache(target, metric);
  }

  return caches
    .filter((cache) => cache.built)
    .map((cache) => ({
      cacheKind: cache.cacheKind,
      replacesGroupId: cache.replacesGroupId,
      metricIds: [...cache.metrics]
        .sort(compareCacheMetrics)
        .map((m) => m.metricId),
    }));
}
