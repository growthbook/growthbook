/** TypeScript port of the gbstats contextual-bandit weight pipeline. */
import type { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import type {
  ContextualBanditResponseSnapshot,
  ContextualBanditSnapshot,
  ContextualLeafMapEntry,
  ContextualLeafStatsEntry,
  ContextualSseTrajectoryEntry,
  MetricSettingsForStatsEngine,
} from "shared/types/stats";
import {
  attributeConditionFromMetricRow,
  contextualBanditAttrCol,
} from "shared/experiments";
import {
  updateVariationWeights,
  type VariationWeightResult,
} from "./banditWeights";
import {
  MAX_EXHAUSTIVE_CATEGORIES,
  type kMeansResult,
} from "./multivariateKMeans";
import { SampleMeanStatistic, ProportionStatistic } from "./statistics";

const COMBINED_CONTEXT_ATTRIBUTE_VALUE = "Combined";

/**
 * Tree-growth split strategy.
 *  - `"kmeans"` (default): each split groups an attribute's categories into two
 *    sets via weighted k-means (`country in (US, CA)` vs not), porting gbstats
 *    `UpdateWeightsContextualTreeKMeans`.
 *  - `"onehot"`: greedy one-hot splits (`country == US` vs not), porting gbstats
 *    `UpdateWeightsContextualTree`.
 */
export type ContextualBanditSplitStrategy = "onehot" | "kmeans";

/** Inputs for `computeContextualBanditWeights`; `keep_theta` is forced off internally. */
export type ContextualBanditWeightsInput = {
  varIds: string[];
  attributes: string[];
  maxLeaves: number;
  minUsersPerLeaf: number;
  metricSettings: MetricSettingsForStatsEngine;
  analysisWeights: number[];
  rows: ExperimentMetricQueryResponseRows;
  /** Defaults to `"kmeans"`. */
  splitStrategy?: ContextualBanditSplitStrategy;
};

type ArmColumns = {
  n: number;
  main_sum: number;
  main_sum_squares: number;
  denominator_sum: number;
  denominator_sum_squares: number;
  main_denominator_sum_product: number;
  covariate_sum: number;
  covariate_sum_squares: number;
  main_covariate_sum_product: number;
};

type MomentStat = {
  n: number;
  mean: number;
  variance: number;
  unadjustedMean: number;
  unadjustedVariance: number;
};

function emptyArm(): ArmColumns {
  return {
    n: 0,
    main_sum: 0,
    main_sum_squares: 0,
    denominator_sum: 0,
    denominator_sum_squares: 0,
    main_denominator_sum_product: 0,
    covariate_sum: 0,
    covariate_sum_squares: 0,
    main_covariate_sum_product: 0,
  };
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rowUnits(row: ExperimentMetricQueryResponseRows[number]): number {
  if ("count" in row && row.count != null) return num(row.count);
  if ("users" in row && row.users != null) return num(row.users);
  return 0;
}

function addRowToArm(
  arm: ArmColumns,
  row: ExperimentMetricQueryResponseRows[number],
): void {
  arm.n += rowUnits(row);
  arm.main_sum += num(row.main_sum);
  arm.main_sum_squares += num(row.main_sum_squares);
  arm.denominator_sum += num(row.denominator_sum);
  arm.denominator_sum_squares += num(row.denominator_sum_squares);
  arm.main_denominator_sum_product += num(row.main_denominator_sum_product);
  arm.covariate_sum += num(row.covariate_sum);
  arm.covariate_sum_squares += num(row.covariate_sum_squares);
  arm.main_covariate_sum_product += num(row.main_covariate_sum_product);
}

function addArms(a: ArmColumns, b: ArmColumns): ArmColumns {
  return {
    n: a.n + b.n,
    main_sum: a.main_sum + b.main_sum,
    main_sum_squares: a.main_sum_squares + b.main_sum_squares,
    denominator_sum: a.denominator_sum + b.denominator_sum,
    denominator_sum_squares:
      a.denominator_sum_squares + b.denominator_sum_squares,
    main_denominator_sum_product:
      a.main_denominator_sum_product + b.main_denominator_sum_product,
    covariate_sum: a.covariate_sum + b.covariate_sum,
    covariate_sum_squares: a.covariate_sum_squares + b.covariate_sum_squares,
    main_covariate_sum_product:
      a.main_covariate_sum_product + b.main_covariate_sum_product,
  };
}

/**
 * Contextual bandits operate only on sample-mean (count) and proportion
 * (binomial) statistics. Ratio, regression-adjusted, and quantile statistics
 * are rejected so the entire pipeline only ever handles those two moment types.
 */
function assertSupportedContextualBanditMetric(
  metric: MetricSettingsForStatsEngine,
): void {
  const supportedMetricType =
    metric.main_metric_type === "count" ||
    metric.main_metric_type === "binomial";
  if (metric.statistic_type !== "mean" || !supportedMetricType) {
    throw new Error(
      "Contextual bandits support only count (sample mean) and binomial " +
        "(proportion) metrics; got " +
        `statistic_type="${metric.statistic_type}", ` +
        `main_metric_type="${String(metric.main_metric_type)}".`,
    );
  }
}

/**
 * Mean/variance for a variation arm. Only sample-mean (count) and proportion
 * (binomial) metrics are supported; `forBandit` recasts binomial -> SampleMean
 * for Thompson sampling (matching gbstats `BanditsSimple`).
 */
function armMomentStat(
  arm: ArmColumns,
  metric: MetricSettingsForStatsEngine,
  forBandit: boolean,
): MomentStat {
  assertSupportedContextualBanditMetric(metric);
  const n = arm.n;
  let stat: SampleMeanStatistic | ProportionStatistic;
  if (metric.main_metric_type === "binomial") {
    stat = forBandit
      ? new SampleMeanStatistic({
          n,
          sum: arm.main_sum,
          sumSquares: arm.main_sum,
        })
      : new ProportionStatistic({ n, sum: arm.main_sum });
  } else {
    stat = new SampleMeanStatistic({
      n,
      sum: arm.main_sum,
      sumSquares: arm.main_sum_squares,
    });
  }
  return {
    n,
    mean: stat.mean,
    variance: stat.variance,
    unadjustedMean: stat.unadjustedMean,
    unadjustedVariance: stat.unadjustedVariance,
  };
}

function computeLeafWeights(
  armsByVariation: ArmColumns[],
  metric: MetricSettingsForStatsEngine,
  currentWeights: number[],
): VariationWeightResult {
  const stats = armsByVariation.map((arm) => armMomentStat(arm, metric, true));
  return updateVariationWeights(stats, currentWeights, metric.inverse);
}

type ContextEntry = {
  tuple: string[];
  condition: Record<string, unknown>;
  arms: ArmColumns[];
};

function contextTuple(
  row: ExperimentMetricQueryResponseRows[number],
  attrColumns: string[],
): string[] {
  return attrColumns.map((col) => {
    const v = (row as Record<string, unknown>)[col];
    return v === undefined || v === null
      ? COMBINED_CONTEXT_ATTRIBUTE_VALUE
      : String(v);
  });
}

function variationIndexFromRow(
  row: ExperimentMetricQueryResponseRows[number],
  varIds: string[],
): number | null {
  const key = String(row.variation ?? "");
  const byId = varIds.indexOf(key);
  if (byId >= 0) return byId;
  const asNum = Number(key);
  if (Number.isInteger(asNum) && asNum >= 0 && asNum < varIds.length) {
    return asNum;
  }
  return null;
}

function partitionByContext(
  rows: ExperimentMetricQueryResponseRows,
  attributes: string[],
  attrColumns: string[],
  varIds: string[],
): ContextEntry[] {
  const byKey = new Map<string, ContextEntry>();
  for (const row of rows) {
    const variationIndex = variationIndexFromRow(row, varIds);
    if (variationIndex === null) continue;
    const tuple = contextTuple(row, attrColumns);
    const key = JSON.stringify(tuple);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        tuple,
        condition: attributeConditionFromMetricRow(
          row as Record<string, string | number | undefined>,
          attributes,
        ),
        arms: Array.from({ length: varIds.length }, emptyArm),
      };
      byKey.set(key, entry);
    }
    addRowToArm(entry.arms[variationIndex], row);
  }
  return [...byKey.values()].sort((a, b) =>
    JSON.stringify(a.tuple) < JSON.stringify(b.tuple) ? -1 : 1,
  );
}

type Feature = { attrIndex: number; category: string };

function buildFeatures(
  contexts: ContextEntry[],
  attrColumns: string[],
): Feature[] {
  const features: Feature[] = [];
  for (let attrIndex = 0; attrIndex < attrColumns.length; attrIndex++) {
    const categories = new Set<string>();
    for (const ctx of contexts) categories.add(ctx.tuple[attrIndex]);
    for (const category of [...categories].sort()) {
      features.push({ attrIndex, category });
    }
  }
  return features;
}

function featureValue(ctx: ContextEntry, feature: Feature): number {
  return ctx.tuple[feature.attrIndex] === feature.category ? 1 : 0;
}

/**
 * Within-group SSE from each member's per-variation arm statistics: pool the
 * arms per variation, then sum `(n - 1) * variance` across variations.
 *
 * Only the three fields the objective reads (`n`, `main_sum`,
 * `main_sum_squares`) are accumulated, into mutable locals, so pooling a group
 * costs three adds per member per variation with no per-step allocation (the
 * previous `addArms` created a fresh nine-field arm on every accumulation). The
 * statistic is still built via `armMomentStat`, so results are bit-identical.
 */
function sumOfSquaredErrorsFromArms(
  armsPerMember: ArmColumns[][],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
): number {
  let sse = 0;
  for (let v = 0; v < numVariations; v++) {
    let n = 0;
    let main_sum = 0;
    let main_sum_squares = 0;
    for (const arms of armsPerMember) {
      const arm = arms[v];
      n += arm.n;
      main_sum += arm.main_sum;
      main_sum_squares += arm.main_sum_squares;
    }
    const stat = armMomentStat(
      { ...emptyArm(), n, main_sum, main_sum_squares },
      metric,
      false,
    );
    sse += (stat.n - 1) * stat.variance;
  }
  return sse;
}

function sumOfSquaredErrors(
  contexts: ContextEntry[],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
): number {
  return sumOfSquaredErrorsFromArms(
    contexts.map((ctx) => ctx.arms),
    metric,
    numVariations,
  );
}

/**
 * Compact per-category sufficient statistics for the split search: exactly the
 * three `ArmColumns` fields the SSE objective reads (`n`, `main_sum`,
 * `main_sum_squares`), laid out per variation as `[n, sum, sumSquares]` in a
 * single `Float64Array` of length `3 * numVariations`. The other six columns
 * are dead weight in the objective, so they are dropped to keep the innermost
 * enumeration loop allocation-free.
 */
type CompactCat = Float64Array;

/** Offsets within a `CompactCat`'s per-variation `[n, sum, sumSquares]` triple. */
const CAT_N = 0;
const CAT_SUM = 1;
const CAT_SUM_SQUARES = 2;

/** Index of least-significant set bit (count of trailing zeros) for `x > 0`. */
function trailingZeros(x: number): number {
  return 31 - Math.clz32(x & -x);
}

/**
 * `(n - 1) * variance` for a single pooled variation arm, computed directly
 * from its sufficient statistics — the exact quantity summed by
 * `sumOfSquaredErrorsFromArms` (which multiplies `armMomentStat`'s variance by
 * `n - 1`), but without allocating a statistic object:
 *  - count / sample-mean: `sumSquares - sum^2 / n` (0 when `n <= 1`).
 *  - binomial / proportion: `(n - 1) * p * (1 - p)`, `p = sum / n` (0 when `n === 0`).
 *
 * Values match `armMomentStat(..., forBandit=false)` up to floating-point
 * rounding (the reference path divides by `n - 1` inside `variance` and then
 * multiplies it back out).
 */
export function armSseDirect(
  n: number,
  sum: number,
  sumSquares: number,
  isBinomial: boolean,
): number {
  if (isBinomial) {
    if (n === 0) return 0;
    const p = sum / n;
    return (n - 1) * p * (1 - p);
  }
  if (n <= 1) return 0;
  return sumSquares - (sum * sum) / n;
}

/** Pooled within-group SSE over compact category stats (sums the direct formula). */
function compactGroupSse(
  cats: CompactCat[],
  numVariations: number,
  isBinomial: boolean,
): number {
  let sse = 0;
  for (let v = 0; v < numVariations; v++) {
    const base = v * 3;
    let n = 0;
    let sum = 0;
    let sumSquares = 0;
    for (const cat of cats) {
      n += cat[base + CAT_N];
      sum += cat[base + CAT_SUM];
      sumSquares += cat[base + CAT_SUM_SQUARES];
    }
    sse += armSseDirect(n, sum, sumSquares, isBinomial);
  }
  return sse;
}

/**
 * Exact optimal two-group partition of `cats` minimizing total pooled SSE,
 * returned in the same `kMeansResult` shape as the clusterers.
 *
 * Optimizations over the generic `ExhaustiveBinaryKMeans`:
 *  - Category 0 is fixed to group 0, so only the `2^(n-1) - 1` non-empty
 *    subsets of the remaining categories are enumerated (each partition once).
 *    This also fixes the canonical orientation (category 0 always in group 0).
 *  - Subsets are walked in Gray-code order, so consecutive subsets differ by one
 *    category: the group-1 running sums move by a single add/subtract in O(V),
 *    with no per-subset rebuild or allocation.
 *  - The group-0 sums are derived as `total - subset`, so only one side is
 *    accumulated.
 *
 * Tie-break: among partitions with equal minimal SSE the earliest Gray-code
 * subset is kept. This is deterministic but can differ from the previous
 * lowest-bitmask rule; on real (non-degenerate) data exact SSE ties do not
 * occur, so the selected split is identical.
 */
function bestExhaustiveBinarySplit(
  cats: CompactCat[],
  numVariations: number,
  isBinomial: boolean,
): kMeansResult {
  const numCat = cats.length;
  if (numCat < 2) {
    return {
      labels: new Array<number>(numCat).fill(0),
      initIdx: [],
      sse: compactGroupSse(cats, numVariations, isBinomial),
      converged: true,
    };
  }

  // Per-variation totals across all categories; group 0's sums are derived from
  // these as `total - subset` so only the subset (group 1) is accumulated.
  const totalN = new Float64Array(numVariations);
  const totalSum = new Float64Array(numVariations);
  const totalSq = new Float64Array(numVariations);
  for (const cat of cats) {
    for (let v = 0; v < numVariations; v++) {
      const base = v * 3;
      totalN[v] += cat[base + CAT_N];
      totalSum[v] += cat[base + CAT_SUM];
      totalSq[v] += cat[base + CAT_SUM_SQUARES];
    }
  }

  // Category 0 stays in group 0; the `free` remaining categories (1..numCat-1)
  // are the ones toggled into/out of group 1.
  const free = numCat - 1;
  const subN = new Float64Array(numVariations);
  const subSum = new Float64Array(numVariations);
  const subSq = new Float64Array(numVariations);

  let grayMask = 0;
  let bestSse = Infinity;
  let bestMask = 0;
  const steps = 1 << free;
  for (let g = 1; g < steps; g++) {
    // Standard reflected Gray code: successive g differ by the bit at
    // trailingZeros(g); flipping it toggles exactly one category's membership.
    const bit = trailingZeros(g);
    const cat = cats[bit + 1];
    const sign = (grayMask >> bit) & 1 ? -1 : 1;
    for (let v = 0; v < numVariations; v++) {
      const base = v * 3;
      subN[v] += sign * cat[base + CAT_N];
      subSum[v] += sign * cat[base + CAT_SUM];
      subSq[v] += sign * cat[base + CAT_SUM_SQUARES];
    }
    grayMask ^= 1 << bit;

    let sse = 0;
    for (let v = 0; v < numVariations; v++) {
      sse +=
        armSseDirect(subN[v], subSum[v], subSq[v], isBinomial) +
        armSseDirect(
          totalN[v] - subN[v],
          totalSum[v] - subSum[v],
          totalSq[v] - subSq[v],
          isBinomial,
        );
    }
    if (sse < bestSse) {
      bestSse = sse;
      bestMask = grayMask;
    }
  }

  const labels = new Array<number>(numCat).fill(0);
  const bestSubset: CompactCat[] = [];
  const bestComplement: CompactCat[] = [cats[0]];
  for (let j = 0; j < free; j++) {
    if ((bestMask >> j) & 1) {
      labels[j + 1] = 1;
      bestSubset.push(cats[j + 1]);
    } else {
      bestComplement.push(cats[j + 1]);
    }
  }

  // Recompute the winning SSE by pooling each side from scratch so the reported
  // value is free of the tiny drift the incremental add/subtract can accumulate.
  const sse =
    compactGroupSse(bestSubset, numVariations, isBinomial) +
    compactGroupSse(bestComplement, numVariations, isBinomial);

  return { labels, initIdx: [], sse, converged: true };
}

/**
 * Approximate optimal two-group partition via weighted k-means (Hartigan local
 * search), used when there are too many categories to enumerate exactly.
 *
 * Unlike the generic `MultivariateKMeans`, this keeps pooled sufficient stats
 * per cluster and scores each candidate move by adding/removing a single
 * category's stats in O(V), so a full pass is O(n·k·V) instead of O(n^2·V) — the
 * generic clusterer re-pools whole clusters (and allocates fresh membership
 * arrays) on every candidate, which is worst exactly when the fallback engages
 * (many categories). The pooled `[n, sum, sumSquares]` representation makes
 * add/remove exact and allocation-free.
 *
 * Forgy initialization uses `Math.random` (matching `MultivariateKMeans`), so
 * the partition is not reproducible across runs; everything after the seed draw
 * is deterministic.
 */
function approximateBinaryKMeans(
  cats: CompactCat[],
  numVariations: number,
  isBinomial: boolean,
  maxIterations: number,
): kMeansResult {
  const numItems = cats.length;
  const k = 2;
  if (numItems === 0) {
    return { labels: [], initIdx: [], sse: 0, converged: true };
  }
  if (numItems < k) {
    return {
      labels: new Array<number>(numItems).fill(0),
      initIdx: [0],
      sse: compactGroupSse(cats, numVariations, isBinomial),
      converged: true,
    };
  }

  const stride = 3 * numVariations;

  // Pooled SSE of `total`, optionally with one category's stats added
  // (`sign = 1`) or removed (`sign = -1`). O(V), allocation-free.
  const pooledSse = (
    total: Float64Array,
    delta: CompactCat | null,
    sign: number,
  ): number => {
    let sse = 0;
    for (let v = 0; v < numVariations; v++) {
      const base = v * 3;
      const d = delta ? sign : 0;
      sse += armSseDirect(
        total[base] + (delta ? d * delta[base] : 0),
        total[base + 1] + (delta ? d * delta[base + 1] : 0),
        total[base + 2] + (delta ? d * delta[base + 2] : 0),
        isBinomial,
      );
    }
    return sse;
  };

  const accumulate = (
    dst: Float64Array,
    src: CompactCat,
    sign: number,
  ): void => {
    for (let j = 0; j < stride; j++) dst[j] += sign * src[j];
  };

  // Forgy seeds: k distinct random categories (partial Fisher-Yates), matching
  // MultivariateKMeans.sampleIndices.
  const pool = Array.from({ length: numItems }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (numItems - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const initIdx = pool.slice(0, k);

  // Assign each category to its nearest seed (lowest two-item pooled SSE), then
  // force each seed into its own cluster so both clusters start non-empty.
  const labels = new Array<number>(numItems);
  for (let i = 0; i < numItems; i++) {
    let bestCluster = 0;
    let bestCost = Infinity;
    for (let c = 0; c < k; c++) {
      const cost = pooledSse(cats[initIdx[c]], cats[i], 1);
      if (cost < bestCost) {
        bestCost = cost;
        bestCluster = c;
      }
    }
    labels[i] = bestCluster;
  }
  for (let c = 0; c < k; c++) labels[initIdx[c]] = c;

  const clusterStats = Array.from(
    { length: k },
    () => new Float64Array(stride),
  );
  const clusterCount = new Array<number>(k).fill(0);
  const clusterSse = new Array<number>(k).fill(0);

  // Hartigan local search: move each category to the cluster that most reduces
  // total SSE (never emptying a cluster) until a full pass makes no move.
  let converged = false;
  for (let iter = 0; iter < maxIterations; iter++) {
    // Rebuild pooled stats from the current labels each pass so the tiny drift
    // from incremental add/remove cannot accumulate across passes (O(n·V), so it
    // does not change the O(n·k·V) per-pass cost).
    for (let c = 0; c < k; c++) {
      clusterStats[c].fill(0);
      clusterCount[c] = 0;
    }
    for (let i = 0; i < numItems; i++) {
      accumulate(clusterStats[labels[i]], cats[i], 1);
      clusterCount[labels[i]]++;
    }
    for (let c = 0; c < k; c++) {
      clusterSse[c] = pooledSse(clusterStats[c], null, 0);
    }

    let moved = false;
    for (let i = 0; i < numItems; i++) {
      const from = labels[i];
      if (clusterCount[from] <= 1) continue;

      const fromWithoutSse = pooledSse(clusterStats[from], cats[i], -1);
      const removeDelta = fromWithoutSse - clusterSse[from];

      let bestCluster = from;
      let bestDelta = 0;
      let bestToWithSse = 0;
      for (let to = 0; to < k; to++) {
        if (to === from) continue;
        const toWithSse = pooledSse(clusterStats[to], cats[i], 1);
        const delta = removeDelta + (toWithSse - clusterSse[to]);
        if (delta < bestDelta - 1e-12) {
          bestDelta = delta;
          bestCluster = to;
          bestToWithSse = toWithSse;
        }
      }

      if (bestCluster !== from) {
        accumulate(clusterStats[from], cats[i], -1);
        clusterCount[from]--;
        clusterSse[from] = fromWithoutSse;
        accumulate(clusterStats[bestCluster], cats[i], 1);
        clusterCount[bestCluster]++;
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

  // Clean final SSE pooled from the final labels (free of incremental drift).
  const finalStats = Array.from({ length: k }, () => new Float64Array(stride));
  for (let i = 0; i < numItems; i++)
    accumulate(finalStats[labels[i]], cats[i], 1);
  let sse = 0;
  for (let c = 0; c < k; c++) sse += pooledSse(finalStats[c], null, 0);

  return { labels, initIdx, sse, converged };
}

/**
 * Per-context leaf assignment enriched with each context's attribute values
 * (parallel to `contexts`): `leafMap[c]` is the leaf and `{alias: value}` map
 * for `contexts[c]`.
 */
function buildLeafMap(
  contexts: ContextEntry[],
  attributes: string[],
  leafByContext: number[],
): ContextualLeafMapEntry[] {
  return contexts.map((ctx, c) => {
    const context: Record<string, string> = {};
    attributes.forEach((alias, i) => {
      context[alias] = ctx.tuple[i];
    });
    return { context, leafId: leafByContext[c] };
  });
}

type BuildTreeResult = {
  /** Per-context leaf assignment with attribute values (parallel to `contexts`). */
  leafMap: ContextualLeafMapEntry[];
  /**
   * Total within-tree SSE at each stage of greedy growth, in order:
   * index 0 is the root (before the first split), index 1 is after the first
   * split, index 2 after the second split, etc. Length = (splits applied) + 1.
   */
  sseTrajectory: number[];
};

function buildTree(
  contexts: ContextEntry[],
  features: Feature[],
  attributes: string[],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
  maxLeaves: number,
  minUsersPerLeaf: number,
): BuildTreeResult {
  const currentLeaf = new Array<number>(contexts.length).fill(0);
  if (contexts.length === 0) {
    return { leafMap: [], sseTrajectory: [] };
  }

  const sideMeetsMinPerVariation = (ctxIdxs: number[]): boolean => {
    for (let v = 0; v < numVariations; v++) {
      let total = 0;
      for (const idx of ctxIdxs) total += contexts[idx].arms[v].n;
      if (total < minUsersPerLeaf) return false;
    }
    return true;
  };

  const totalSse = (): number => {
    let total = 0;
    for (const leafId of new Set(currentLeaf)) {
      const inLeaf: ContextEntry[] = [];
      for (let c = 0; c < contexts.length; c++) {
        if (currentLeaf[c] === leafId) inLeaf.push(contexts[c]);
      }
      total += sumOfSquaredErrors(inLeaf, metric, numVariations);
    }
    return total;
  };

  const sseTrajectory: number[] = [totalSse()];

  for (let iteration = 0; iteration < maxLeaves - 1; iteration++) {
    const leafIds = [...new Set(currentLeaf)];
    const numLeaves = leafIds.length;

    let bestGain = -Infinity;
    let bestFeature = -1;
    let bestLeaf = -1;

    for (let leafIndex = 0; leafIndex < numLeaves; leafIndex++) {
      const inLeaf: number[] = [];
      for (let c = 0; c < contexts.length; c++) {
        if (currentLeaf[c] === leafIndex) inLeaf.push(c);
      }
      if (inLeaf.length === 0) continue;
      const sseCurrent = sumOfSquaredErrors(
        inLeaf.map((c) => contexts[c]),
        metric,
        numVariations,
      );
      for (let f = 0; f < features.length; f++) {
        const side0: number[] = [];
        const side1: number[] = [];
        for (const c of inLeaf) {
          if (featureValue(contexts[c], features[f]) === 1) side1.push(c);
          else side0.push(c);
        }
        if (side0.length === 0 || side1.length === 0) continue;
        if (
          !sideMeetsMinPerVariation(side0) ||
          !sideMeetsMinPerVariation(side1)
        ) {
          continue;
        }
        const sseSplit =
          sumOfSquaredErrors(
            side0.map((c) => contexts[c]),
            metric,
            numVariations,
          ) +
          sumOfSquaredErrors(
            side1.map((c) => contexts[c]),
            metric,
            numVariations,
          );
        const gain = sseCurrent - sseSplit;
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestLeaf = leafIndex;
        }
      }
    }

    if (bestFeature < 0 || bestGain <= 0) break;

    const newLeaf = iteration + 1;
    for (let c = 0; c < contexts.length; c++) {
      if (
        currentLeaf[c] === bestLeaf &&
        featureValue(contexts[c], features[bestFeature]) === 1
      ) {
        currentLeaf[c] = newLeaf;
      }
    }

    sseTrajectory.push(totalSse());
  }
  return {
    leafMap: buildLeafMap(contexts, attributes, currentLeaf),
    sseTrajectory,
  };
}

/** A leaf's best candidate split, cached across growth iterations. */
type LeafSplit = {
  /** Attribute whose category partition yields this leaf's best split. */
  attrIndex: number;
  /** Categories assigned to the split-off side (label 1). */
  group: Set<string>;
  /** The leaf's SSE before splitting. */
  sseCurrent: number;
  /** Total SSE of the two sides after the split. */
  splitSse: number;
  /** SSE reduction from the split (`sseCurrent - splitSse`). */
  gain: number;
};

/**
 * Greedy SSE regression tree up to `maxLeaves` where each split groups one
 * attribute's categories into two sets via weighted k-means (porting gbstats
 * `UpdateWeightsContextualTreeKMeans`). This admits multi-category splits like
 * `country in (US, CA)` vs not, rather than only `country == US` vs not.
 *
 * A split is taken only when the best available (non-degenerate) binary
 * category partition strictly reduces total SSE; there is no minimum-users-
 * per-leaf guard. For attributes with at most `MAX_EXHAUSTIVE_CATEGORIES`
 * categories the optimal partition is found exactly (via
 * `bestExhaustiveBinarySplit`); otherwise it falls back to `MultivariateKMeans`,
 * whose Forgy initialization uses `Math.random`, so those partitions (and hence
 * the tree) are not reproducible across runs.
 *
 * Performance: each leaf's best split is cached and only the two leaves touched
 * by a split are re-evaluated per iteration; the exact split search enumerates
 * partitions incrementally over compact per-variation stats (see
 * `bestExhaustiveBinarySplit`). Split SSE and gains are computed with the direct
 * SS formula (`armSseDirect`), which matches the reference `armMomentStat` path
 * up to floating-point rounding.
 */
function buildTreeKMeans(
  contexts: ContextEntry[],
  attributes: string[],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
  maxLeaves: number,
): BuildTreeResult {
  const currentLeaf = new Array<number>(contexts.length).fill(0);
  if (contexts.length === 0) {
    return { leafMap: [], sseTrajectory: [] };
  }

  // Contextual bandits are asserted to be count or binomial only; the split
  // objective reads the metric type once here rather than per candidate.
  const isBinomial = metric.main_metric_type === "binomial";

  const totalSse = (): number => {
    let total = 0;
    for (const leafId of new Set(currentLeaf)) {
      const inLeaf: ContextEntry[] = [];
      for (let c = 0; c < contexts.length; c++) {
        if (currentLeaf[c] === leafId) inLeaf.push(contexts[c]);
      }
      total += sumOfSquaredErrors(inLeaf, metric, numVariations);
    }
    return total;
  };

  // Pooled within-leaf SSE over a set of contexts, using only the three fields
  // the objective reads (matches `sumOfSquaredErrors` up to fp rounding).
  const contextsSseDirect = (ctxIdxs: number[]): number => {
    let sse = 0;
    for (let v = 0; v < numVariations; v++) {
      let n = 0;
      let sum = 0;
      let sumSquares = 0;
      for (const c of ctxIdxs) {
        const arm = contexts[c].arms[v];
        n += arm.n;
        sum += arm.main_sum;
        sumSquares += arm.main_sum_squares;
      }
      sse += armSseDirect(n, sum, sumSquares, isBinomial);
    }
    return sse;
  };

  // Optimal (or k-means-approximate) binary partition of an attribute's
  // categories: exact subset enumeration when few enough categories, otherwise
  // weighted k-means (Hartigan local search) as an approximate fallback.
  const partitionCategories = (cats: CompactCat[]): kMeansResult =>
    cats.length <= MAX_EXHAUSTIVE_CATEGORIES
      ? bestExhaustiveBinarySplit(cats, numVariations, isBinomial)
      : approximateBinaryKMeans(cats, numVariations, isBinomial, 100);

  // Best split for a single leaf, computed independently of every other leaf.
  // This independence is what makes the per-leaf cache below valid: a leaf's
  // best split depends only on its own contexts. Returns null when the leaf
  // admits no valid (non-degenerate) split.
  const evaluateLeafBestSplit = (leafId: number): LeafSplit | null => {
    const inLeaf: number[] = [];
    for (let c = 0; c < contexts.length; c++) {
      if (currentLeaf[c] === leafId) inLeaf.push(c);
    }
    if (inLeaf.length === 0) return null;

    const sseCurrent = contextsSseDirect(inLeaf);

    let best: LeafSplit | null = null;
    for (let attrIndex = 0; attrIndex < attributes.length; attrIndex++) {
      // Compact per-category sufficient stats within the leaf, accumulated in a
      // single pass (sorted by category for stable ordering).
      const byCategory = new Map<string, CompactCat>();
      for (const c of inLeaf) {
        const key = contexts[c].tuple[attrIndex];
        let compact = byCategory.get(key);
        if (!compact) {
          compact = new Float64Array(3 * numVariations);
          byCategory.set(key, compact);
        }
        const arms = contexts[c].arms;
        for (let v = 0; v < numVariations; v++) {
          const base = v * 3;
          compact[base + CAT_N] += arms[v].n;
          compact[base + CAT_SUM] += arms[v].main_sum;
          compact[base + CAT_SUM_SQUARES] += arms[v].main_sum_squares;
        }
      }
      const categories = [...byCategory.keys()].sort();
      if (categories.length < 2) continue;
      const cats = categories.map((category) => {
        const compact = byCategory.get(category);
        if (!compact) throw new Error("missing category stats");
        return compact;
      });

      const km = partitionCategories(cats);
      const labels = km.labels;

      const group = new Set(categories.filter((_, i) => labels[i] === 1));
      // Both sides must be non-empty for a real split.
      if (group.size === 0 || group.size === categories.length) continue;

      // The clusterer already minimized this same pooled-SSE objective over the
      // category statistics, so its achieved SSE is the split SSE (pooling a
      // group's category arms is identical to pooling that group's contexts).
      const candidateSseSplit = km.sse;
      const gain = sseCurrent - candidateSseSplit;
      if (best === null || gain > best.gain) {
        best = {
          attrIndex,
          group,
          sseCurrent,
          splitSse: candidateSseSplit,
          gain,
        };
      }
    }
    return best;
  };

  const sseTrajectory: number[] = [totalSse()];

  // Per-leaf best-split cache. After a split only the two child leaves change,
  // so every other leaf's cached best split stays valid; re-evaluating just the
  // dirty leaves cuts per-iteration work from O(leaves) fits to O(1).
  const splitCache = new Map<number, LeafSplit | null>();
  let dirtyLeaves = new Set<number>(currentLeaf);

  for (let iteration = 0; iteration < maxLeaves - 1; iteration++) {
    for (const leafId of dirtyLeaves) {
      splitCache.set(leafId, evaluateLeafBestSplit(leafId));
    }
    dirtyLeaves = new Set<number>();

    let bestGain = -Infinity;
    let bestAttr = -1;
    let bestLeaf = -1;
    let bestGroup: Set<string> = new Set();
    // Visit leaves in ascending id order so gain ties resolve to the earliest
    // leaf (and, within a leaf, the earliest attribute), matching the original
    // single-pass selection.
    for (const leafId of [...new Set(currentLeaf)].sort((a, b) => a - b)) {
      const candidate = splitCache.get(leafId);
      if (!candidate) continue;
      if (candidate.gain > bestGain) {
        bestGain = candidate.gain;
        bestAttr = candidate.attrIndex;
        bestLeaf = leafId;
        bestGroup = candidate.group;
      }
    }

    // Stop when no leaf admits a further valid split, or the best available
    // split does not strictly reduce total SSE (e.g. identical categories).
    if (bestAttr < 0 || bestGain <= 0) break;

    const newLeaf = iteration + 1;
    for (let c = 0; c < contexts.length; c++) {
      if (
        currentLeaf[c] === bestLeaf &&
        bestGroup.has(contexts[c].tuple[bestAttr])
      ) {
        currentLeaf[c] = newLeaf;
      }
    }
    sseTrajectory.push(totalSse());

    // Only the split leaf and its new child changed; re-evaluate just those two
    // next iteration and reuse every other leaf's cached best split.
    dirtyLeaves = new Set<number>([bestLeaf, newLeaf]);
  }

  return {
    leafMap: buildLeafMap(contexts, attributes, currentLeaf),
    sseTrajectory,
  };
}

/** Compute updated contextual-bandit weights, returning the Python-shape snapshot. */
export function computeContextualBanditWeights(
  input: ContextualBanditWeightsInput,
): ContextualBanditSnapshot {
  const {
    varIds,
    attributes,
    maxLeaves,
    minUsersPerLeaf,
    metricSettings: metricSettingsInput,
    analysisWeights,
    rows,
  } = input;

  const metricSettings: MetricSettingsForStatsEngine = {
    ...metricSettingsInput,
    keep_theta: false,
  };

  // Fail fast on unsupported metrics so we never partially process a run that
  // uses anything other than a sample-mean (count) or proportion (binomial).
  assertSupportedContextualBanditMetric(metricSettings);

  const numVariations = varIds.length;
  const defaultWeights =
    analysisWeights.length === numVariations
      ? analysisWeights.slice()
      : Array(numVariations).fill(1 / numVariations);

  const attrColumns = attributes.map(contextualBanditAttrCol);

  const contexts = partitionByContext(rows, attributes, attrColumns, varIds);

  if (contexts.length === 0) {
    return { attributes, responses: [], leaf_map: [] };
  }

  const { leafMap, sseTrajectory } =
    input.splitStrategy === "onehot"
      ? buildTree(
          contexts,
          buildFeatures(contexts, attrColumns),
          attributes,
          metricSettings,
          numVariations,
          maxLeaves,
          minUsersPerLeaf,
        )
      : buildTreeKMeans(
          contexts,
          attributes,
          metricSettings,
          numVariations,
          maxLeaves,
        );

  const leafArms = new Map<number, ArmColumns[]>();
  for (let c = 0; c < contexts.length; c++) {
    const leafId = leafMap[c].leafId;
    let arms = leafArms.get(leafId);
    if (!arms) {
      arms = Array.from({ length: numVariations }, emptyArm);
      leafArms.set(leafId, arms);
    }
    for (let v = 0; v < numVariations; v++) {
      arms[v] = addArms(arms[v], contexts[c].arms[v]);
    }
  }

  const leafWeights = new Map<number, VariationWeightResult>();
  for (const [leafId, arms] of leafArms) {
    leafWeights.set(
      leafId,
      computeLeafWeights(arms, metricSettings, defaultWeights),
    );
  }

  const sortedLeafArms = [...leafArms.entries()].sort((a, b) => a[0] - b[0]);

  const leaf_stats: ContextualLeafStatsEntry[] = sortedLeafArms.map(
    ([leafId, arms]) => {
      const stats = arms.map((arm) =>
        armMomentStat(arm, metricSettings, false),
      );
      return {
        leafId,
        sampleSizePerVariation: stats.map((s) => s.n),
        sampleMeans: stats.map((s) => s.unadjustedMean),
        sampleVariances: stats.map((s) => s.unadjustedVariance),
      };
    },
  );

  const sse_trajectory: ContextualSseTrajectoryEntry[] = sseTrajectory.map(
    (totalSse, numSplits) => ({ numSplits, totalSse }),
  );

  const responses: ContextualBanditResponseSnapshot[] = [];

  for (let c = 0; c < contexts.length; c++) {
    const ctx = contexts[c];
    const leafId = leafMap[c].leafId;
    const leaf = leafWeights.get(leafId);

    const contextStats = ctx.arms.map((arm) =>
      armMomentStat(arm, metricSettings, false),
    );

    responses.push({
      context: ctx.condition,
      sampleSizePerVariation: contextStats.map((s) => s.n),
      sampleMeans: contextStats.map((s) => s.unadjustedMean),
      sampleVariances: contextStats.map((s) => s.unadjustedVariance),
      updatedWeights: leaf ? leaf.updatedWeights : defaultWeights.slice(),
      bestArmProbabilities: leaf ? leaf.bestArmProbabilities : null,
      updateMessage: leaf ? leaf.updateMessage : "No update",
      error: leaf ? leaf.error : null,
    });
  }

  return {
    attributes,
    responses,
    leaf_map: leafMap,
    leaf_stats,
    sse_trajectory,
  };
}
