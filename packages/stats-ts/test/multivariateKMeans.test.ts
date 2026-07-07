import { MultivariateKMeans } from "../src/multivariateKMeans";

/** A per-item statistic: a coordinate vector with a per-coordinate weight. */
type WeightedPoint = { point: number[]; weight: number[] };

/**
 * Weighted within-group SSE about the group's own weighted centroid — the same
 * objective the vector k-means used to minimize, now expressed as the
 * caller-supplied group score.
 */
function weightedSse(group: WeightedPoint[]): number {
  if (group.length === 0) return 0;
  const numDims = group[0].point.length;
  const centroid = new Array<number>(numDims).fill(0);
  for (let d = 0; d < numDims; d++) {
    let wsum = 0;
    let weightedSum = 0;
    let plainSum = 0;
    for (const g of group) {
      wsum += g.weight[d];
      weightedSum += g.weight[d] * g.point[d];
      plainSum += g.point[d];
    }
    centroid[d] = wsum > 0 ? weightedSum / wsum : plainSum / group.length;
  }
  let sse = 0;
  for (const g of group) {
    for (let d = 0; d < numDims; d++) {
      const diff = g.point[d] - centroid[d];
      sse += g.weight[d] * diff * diff;
    }
  }
  return sse;
}

function unweighted(points: number[][]): WeightedPoint[] {
  return points.map((point) => ({ point, weight: point.map(() => 1) }));
}

/** Total objective of a labeling: sum of the group SSE over all clusters. */
function totalSse(stats: WeightedPoint[], labels: number[]): number {
  const byLabel = new Map<number, WeightedPoint[]>();
  labels.forEach((lab, i) => {
    const g = byLabel.get(lab);
    if (g) g.push(stats[i]);
    else byLabel.set(lab, [stats[i]]);
  });
  let total = 0;
  for (const group of byLabel.values()) total += weightedSse(group);
  return total;
}

/** Brute-force minimum total SSE over all non-trivial two-group partitions. */
function bestTwoGroupSse(stats: WeightedPoint[]): number {
  const n = stats.length;
  let best = Infinity;
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const a: WeightedPoint[] = [];
    const b: WeightedPoint[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask >> i) & 1) a.push(stats[i]);
      else b.push(stats[i]);
    }
    best = Math.min(best, weightedSse(a) + weightedSse(b));
  }
  return best;
}

/** Group item indices by their assigned (contiguous) cluster label. */
function clustersOf(labels: number[]): number[][] {
  const groups = new Map<number, number[]>();
  labels.forEach((lab, i) => {
    const g = groups.get(lab);
    if (g) g.push(i);
    else groups.set(lab, [i]);
  });
  return [...groups.values()];
}

/** Set equality on arrays of numbers (order-insensitive). */
function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

describe("MultivariateKMeans", () => {
  it("returns no labels for an empty item set", () => {
    const km = new MultivariateKMeans<WeightedPoint>(2).fit([], weightedSse);
    expect(km.labels).toEqual([]);
    expect(km.initIdx).toEqual([]);
  });

  it("assigns every item to one cluster when n_clusters = 1", () => {
    const stats = unweighted([
      [0, 0],
      [1, 1],
      [5, 5],
    ]);
    const labels = new MultivariateKMeans<WeightedPoint>(1).fitPredict(
      stats,
      weightedSse,
    );
    expect(labels).toEqual([0, 0, 0]);
  });

  it("separates two well-separated blobs (regardless of init)", () => {
    // Two tight, far-apart blobs: the optimal 2-means partition is unique, so
    // local search must recover it from any Forgy start.
    const stats = unweighted([
      [0, 0],
      [0.1, -0.1],
      [-0.1, 0.05],
      [10, 10],
      [10.1, 9.9],
      [9.95, 10.05],
    ]);
    const expectedA = [0, 1, 2];
    const expectedB = [3, 4, 5];

    for (let trial = 0; trial < 20; trial++) {
      const labels = new MultivariateKMeans<WeightedPoint>(2).fitPredict(
        stats,
        weightedSse,
      );
      const clusters = clustersOf(labels);
      expect(clusters.length).toBe(2);
      const matches =
        (sameMembers(clusters[0], expectedA) &&
          sameMembers(clusters[1], expectedB)) ||
        (sameMembers(clusters[0], expectedB) &&
          sameMembers(clusters[1], expectedA));
      expect(matches).toBe(true);
    }
  });

  it("uses cluster ids in [0, k) with all clusters non-empty", () => {
    const stats = unweighted([
      [10, 10],
      [10.1, 9.9],
      [0, 0],
      [0.1, 0.1],
    ]);
    const labels = new MultivariateKMeans<WeightedPoint>(2).fitPredict(
      stats,
      weightedSse,
    );
    // Labeling is not normalized to first-appearance order; only the set of
    // ids is guaranteed (both clusters used, ids in [0, k)).
    expect(new Set(labels)).toEqual(new Set([0, 1]));
  });

  it("never produces more non-empty clusters than items", () => {
    const stats = unweighted([
      [1, 1],
      [2, 2],
    ]);
    const labels = new MultivariateKMeans<WeightedPoint>(5).fitPredict(
      stats,
      weightedSse,
    );
    expect(labels.length).toBe(2);
    expect(new Set(labels).size).toBeLessThanOrEqual(2);
  });

  it("reaches the optimal weighted partition for separable data", () => {
    // Two far-apart pairs with uneven weights: the unique optimal 2-partition
    // is {0,1} | {2,3}, and the weighted SSE objective must be honored.
    const stats: WeightedPoint[] = [
      { point: [0], weight: [3] },
      { point: [1], weight: [1] },
      { point: [20], weight: [1] },
      { point: [21], weight: [5] },
    ];
    const optimum = bestTwoGroupSse(stats);

    for (let trial = 0; trial < 20; trial++) {
      const labels = new MultivariateKMeans<WeightedPoint>(2).fitPredict(
        stats,
        weightedSse,
      );
      expect(clustersOf(labels).length).toBe(2);
      expect(totalSse(stats, labels)).toBeCloseTo(optimum, 10);
    }
  });
});
