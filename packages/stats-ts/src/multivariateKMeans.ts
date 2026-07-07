/**
 * Result of a k-means `.fit()`: the fitted state (mirrors the instance fields)
 * plus whether the algorithm converged.
 */
export interface kMeansResult {
  /** Cluster id for each item (see the class docs for labeling semantics). */
  labels: number[];
  /** Item indices chosen as the initial (Forgy) seeds, in cluster order. */
  initIdx: number[];
  /** Total within-cluster SSE (the minimized objective) at the final labels. */
  sse: number;
  /**
   * Whether the algorithm converged. `ExhaustiveBinaryKMeans` is exact and
   * always converges; `MultivariateKMeans` fails to converge (`false`) when it
   * exhausts `maxIterations` without reaching a stable assignment.
   */
  converged: boolean;
}

/**
 * Sample-size-weighted k-means over arbitrary per-item statistics.
 *
 * Shares the same interface as `ExhaustiveBinaryKMeans`: the caller passes one
 * statistic per item plus a function that scores a group of those statistics,
 * and the clustering minimizes the total of that score (the sum-of-squares
 * error, SSE) across `nClusters` clusters.
 *
 * Because the objective is supplied as an opaque group-SSE function rather than
 * point coordinates, clustering uses Hartigan-style local search instead of
 * Lloyd's: starting from a Forgy initialization (k random items as seeds), each
 * item is moved one at a time to whichever cluster most reduces total SSE, until
 * nothing moves. Every cluster is kept non-empty. This finds a local optimum;
 * for an exact (global) two-way split with few items, use
 * `ExhaustiveBinaryKMeans`.
 *
 * Forgy initialization uses `Math.random`, so results are not reproducible
 * across runs (matching the non-seeded style of the rest of `stats-ts`).
 */
export class MultivariateKMeans<TStat> {
  private readonly nClusters: number;
  private readonly maxIterations: number;

  /**
   * Cluster id in `[0, k)` for each item. Which physical id a cluster gets is
   * arbitrary (seeded by the Forgy initialization), so the labeling is not
   * normalized to first-appearance order.
   */
  public labels: number[] = [];
  /** Item indices chosen as the initial (Forgy) seeds, in cluster order. */
  public initIdx: number[] = [];
  /** Total within-cluster SSE (the minimized objective) at the final labels. */
  public sse = 0;

  constructor(nClusters: number, maxIterations = 100) {
    if (nClusters < 1) {
      throw new Error("nClusters must be >= 1");
    }
    this.nClusters = Math.floor(nClusters);
    this.maxIterations = Math.floor(maxIterations);
  }

  /** k distinct item indices, drawn uniformly at random (partial Fisher-Yates). */
  private static sampleIndices(numItems: number, k: number): number[] {
    const pool = Array.from({ length: numItems }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (numItems - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, k);
  }

  fit(
    statistics: TStat[],
    sumOfSquaresError: (group: TStat[]) => number,
  ): kMeansResult {
    const numItems = statistics.length;
    if (numItems === 0) {
      this.labels = [];
      this.initIdx = [];
      this.sse = 0;
      return this.result(true);
    }

    // Cannot create more clusters than items.
    const k = Math.min(this.nClusters, numItems);
    const initIdx = MultivariateKMeans.sampleIndices(numItems, k);
    this.initIdx = initIdx;

    if (k <= 1) {
      this.labels = new Array<number>(numItems).fill(0);
      this.sse = sumOfSquaresError(statistics);
      return this.result(true);
    }

    const groupOf = (members: number[]): TStat[] =>
      members.map((i) => statistics[i]);

    // Forgy initialization: assign each item to the seed whose two-item group
    // has the lowest SSE (its nearest seed), then force each seed into its own
    // cluster so all k clusters start non-empty.
    const labels = statistics.map((stat) => {
      let bestCluster = 0;
      let bestCost = Infinity;
      for (let c = 0; c < k; c++) {
        const cost = sumOfSquaresError([statistics[initIdx[c]], stat]);
        if (cost < bestCost) {
          bestCost = cost;
          bestCluster = c;
        }
      }
      return bestCluster;
    });
    for (let c = 0; c < k; c++) labels[initIdx[c]] = c;
    // Current membership and cached SSE per cluster.
    const clusters: number[][] = Array.from({ length: k }, () => []);
    labels.forEach((c, i) => clusters[c].push(i));
    const clusterSse = clusters.map((members) =>
      sumOfSquaresError(groupOf(members)),
    );

    // Hartigan local search: repeatedly move each item to the cluster that most
    // reduces total SSE, never emptying a cluster, until nothing moves. The
    // search converges only if a full pass makes no moves before we exhaust
    // `maxIterations`.
    let converged = false;
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      let moved = false;
      for (let i = 0; i < numItems; i++) {
        const from = labels[i];
        if (clusters[from].length <= 1) continue;

        const fromWithout = clusters[from].filter((x) => x !== i);
        const fromWithoutSse = sumOfSquaresError(groupOf(fromWithout));
        const removeDelta = fromWithoutSse - clusterSse[from];

        let bestCluster = from;
        let bestDelta = 0;
        let bestToWith: number[] = [];
        let bestToWithSse = 0;
        for (let to = 0; to < k; to++) {
          if (to === from) continue;
          const toWith = [...clusters[to], i];
          const toWithSse = sumOfSquaresError(groupOf(toWith));
          const delta = removeDelta + (toWithSse - clusterSse[to]);
          if (delta < bestDelta - 1e-12) {
            bestDelta = delta;
            bestCluster = to;
            bestToWith = toWith;
            bestToWithSse = toWithSse;
          }
        }

        if (bestCluster !== from) {
          clusters[from] = fromWithout;
          clusterSse[from] = fromWithoutSse;
          clusters[bestCluster] = bestToWith;
          clusterSse[bestCluster] = bestToWithSse;
          labels[i] = bestCluster;
          moved = true;
        }
      }
      if (!moved) {
        converged = true;
        break;
      }
    }

    this.labels = labels;
    this.sse = clusterSse.reduce((total, s) => total + s, 0);

    return this.result(converged);
  }

  /** Snapshot the current instance state into a `kMeansResult`. */
  private result(converged: boolean): kMeansResult {
    return {
      labels: this.labels,
      initIdx: this.initIdx,
      sse: this.sse,
      converged,
    };
  }

  fitPredict(
    statistics: TStat[],
    sumOfSquaresError: (group: TStat[]) => number,
  ): number[] {
    return this.fit(statistics, sumOfSquaresError).labels;
  }
}

/** Most categories `ExhaustiveBinaryKMeans` will enumerate (2^n partitions). */
export const MAX_EXHAUSTIVE_CATEGORIES = 15;

/**
 * Exact two-group partitioner over arbitrary per-item statistics.
 *
 * Enumerates every one of the `2^n` assignments of `n` items into two non-empty
 * groups and keeps the partition with the lowest total sum-of-squares error.
 * The caller supplies the statistics (one entry per item) and a function that
 * scores a group of those statistics, so the SSE objective is defined entirely
 * by the caller's data. The result is deterministic.
 *
 * The enumeration is exponential, so it throws when there are more than
 * `MAX_EXHAUSTIVE_CATEGORIES` items.
 */
export class ExhaustiveBinaryKMeans<TStat> {
  /**
   * Group id (0 or 1) for each item. Orientation is canonical: the group
   * containing the first item is always 0 (matching the R `RelabelContiguous`
   * convention), so the labeling is never the complement of another impl's.
   */
  public labels: number[] = [];
  /** Not applicable (no random init); present for `MultivariateKMeans` parity. */
  public initIdx: number[] = [];
  /** Total within-group SSE (the minimized objective) at the chosen partition. */
  public sse = 0;

  fit(
    statistics: TStat[],
    sumOfSquaresError: (group: TStat[]) => number,
  ): kMeansResult {
    const numItems = statistics.length;
    if (numItems === 0) {
      this.labels = [];
      this.sse = 0;
      return this.result();
    }
    if (numItems > MAX_EXHAUSTIVE_CATEGORIES) {
      throw new Error(
        `ExhaustiveBinaryKMeans supports at most ${MAX_EXHAUSTIVE_CATEGORIES} categories (got ${numItems})`,
      );
    }

    // Fewer than two items cannot form two non-empty groups.
    if (numItems < 2) {
      this.labels = new Array<number>(numItems).fill(0);
      this.sse = sumOfSquaresError(statistics);
      return this.result();
    }

    // Enumerate every assignment of the n items to two groups, skipping the
    // two degenerate masks (all-0 and all-1) so both groups stay non-empty.
    let bestSse = Infinity;
    let bestMask = 0;
    const total = 1 << numItems;
    for (let mask = 1; mask < total - 1; mask++) {
      // Split the items into the subset selected by `mask` and its complement.
      const subset: TStat[] = [];
      const complement: TStat[] = [];
      for (let i = 0; i < numItems; i++) {
        if ((mask >> i) & 1) subset.push(statistics[i]);
        else complement.push(statistics[i]);
      }

      const sse = sumOfSquaresError(subset) + sumOfSquaresError(complement);
      if (sse < bestSse) {
        bestSse = sse;
        bestMask = mask;
      }
    }

    const bestLabels = new Array<number>(numItems);
    for (let i = 0; i < numItems; i++) {
      bestLabels[i] = (bestMask >> i) & 1;
    }

    // Canonical orientation: force the first item into group 0, so a split's
    // 0/1 labeling is deterministic.  Used for matching purposes.
    this.labels =
      bestLabels[0] === 1 ? bestLabels.map((l) => 1 - l) : bestLabels;
    this.sse = bestSse;

    return this.result();
  }

  /**
   * Snapshot the current instance state into a `kMeansResult`. Exhaustive search
   * is exact, so it always reports `converged: true`.
   */
  private result(): kMeansResult {
    return {
      labels: this.labels,
      initIdx: this.initIdx,
      sse: this.sse,
      converged: true,
    };
  }

  fitPredict(
    statistics: TStat[],
    sumOfSquaresError: (group: TStat[]) => number,
  ): number[] {
    return this.fit(statistics, sumOfSquaresError).labels;
  }
}
