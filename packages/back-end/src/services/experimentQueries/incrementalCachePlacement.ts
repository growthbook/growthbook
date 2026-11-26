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
 * to the cache whose first metric sorts first. That last tie-break reads only
 * what the caches hold, and from scratch it picks the cache opened first, so
 * a stored layout and a full refresh break an exact tie the same way.
 *
 * When a kind has stored caches, its new metrics are placed as one batch so
 * they rebuild as few caches as possible: the remaining batch goes whole into
 * the smallest cache this run builds that fits it, else into the smallest
 * stored cache that fits it. Only when none does is its next metric placed on
 * its own, into a cache this run builds before any untouched stored cache.
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
    cache.built = true;
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

  // How many of these metrics have another side in a cache this one is
  // already joined with.
  const joinedSides = (cache: Cache, batch: CacheMetric[]) =>
    batch.filter((metric) => {
      const otherSides = cachesByMetricId.get(metric.metricId) ?? [];
      return [...cachesByMetricId].some(
        ([metricId, holders]) =>
          metricId !== metric.metricId &&
          holders.includes(cache) &&
          holders.some((holder) => otherSides.includes(holder)),
      );
    }).length;
  const compareFirstMetrics = (a: Cache, b: Cache) => {
    const [firstOfA, firstOfB] = [a, b].map((cache) =>
      cache.metrics.reduce<CacheMetric | null>(
        (first, metric) =>
          first && compareCacheMetrics(first, metric) <= 0 ? first : metric,
        null,
      ),
    );
    return firstOfA && firstOfB ? compareCacheMetrics(firstOfA, firstOfB) : 0;
  };
  const fits = (cache: Cache, batch: CacheMetric[]) =>
    BASE_COLUMNS_PER_QUERY +
      cache.columns +
      batch.reduce((sum, m) => sum + m.columns, 0) <=
      maxColumns &&
    cache.metrics.length + batch.length <= MAX_METRICS_PER_QUERY;
  const smallest = (
    candidates: Cache[],
    batch: CacheMetric[],
    { builtFirst }: { builtFirst: boolean },
  ): Cache | undefined =>
    candidates.sort(
      (a, b) =>
        (builtFirst ? Number(b.built) - Number(a.built) : 0) ||
        a.columns - b.columns ||
        Number(b.built) - Number(a.built) ||
        a.metrics.length - b.metrics.length ||
        joinedSides(b, batch) - joinedSides(a, batch) ||
        compareFirstMetrics(a, b) ||
        a.order - b.order,
    )[0];
  const openCache = (cacheKind: string): Cache => {
    const cache: Cache = {
      order: caches.length,
      cacheKind,
      replacesGroupId: null,
      metrics: [],
      columns: 0,
      built: true,
    };
    caches.push(cache);
    return cache;
  };

  const sorted = [...metrics].sort(compareCacheMetrics);
  for (const cacheKind of [...new Set(sorted.map((m) => m.cacheKind))]) {
    const ofKind = caches.filter((cache) => cache.cacheKind === cacheKind);
    const batch = sorted.filter((m) => m.cacheKind === cacheKind);
    const batched = ofKind.some((cache) => cache.replacesGroupId !== null);
    for (let i = 0; i < batch.length; i++) {
      const remaining = batch.slice(i);
      const candidates = caches.filter((c) => c.cacheKind === cacheKind);
      if (batched) {
        const whole =
          smallest(
            candidates.filter((c) => c.built && fits(c, remaining)),
            remaining,
            { builtFirst: false },
          ) ??
          smallest(
            candidates.filter((c) => !c.built && fits(c, remaining)),
            remaining,
            { builtFirst: false },
          );
        if (whole) {
          remaining.forEach((metric) => addToCache(whole, metric));
          break;
        }
      }
      const metric = batch[i];
      const target =
        smallest(
          candidates.filter((c) => fits(c, [metric])),
          [metric],
          { builtFirst: batched },
        ) ?? openCache(cacheKind);
      addToCache(target, metric);
    }
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
