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
  leafClausesFromContexts,
} from "shared/experiments";
import {
  updateVariationWeights,
  type VariationWeightResult,
} from "./banditWeights";
import { SampleMeanStatistic } from "./statistics";

const COMBINED_CONTEXT_ATTRIBUTE_VALUE = "Combined";

/**
 * Pin a binary (0/1) labeling to a canonical orientation where the first
 * category is always in cluster 0.
 */
function canonicalizeBinaryLabels(labels: number[]): number[] {
  if (labels.length > 0 && labels[0] !== 0) {
    for (let i = 0; i < labels.length; i++) labels[i] = labels[i] === 0 ? 1 : 0;
  }
  return labels;
}

/**
 * Most categories the exact binary splitter (`bestExhaustiveBinarySplit`) will
 * enumerate. Above this the split falls back to the approximate k-means search
 * (`approximateBinaryKMeans`).
 */
const MAX_EXHAUSTIVE_CATEGORIES = 15;

/**
 * Maximum number of contextual attributes included in a single analysis run.
 * Only the first `MAX_ATTRIBUTES` attributes are used each time the bandit runs.
 */
const MAX_ATTRIBUTES = 10;

/**
 * Result of a two-group category split: the group id (0/1) for each category,
 * the achieved total pooled within-group SSE, and whether the search converged.
 * `initIdx` indicates which contexts serve as the initial centriods.
 */
interface kMeansResult {
  labels: number[];
  initIdx: number[];
  sse: number;
  converged: boolean;
}

/** Inputs for `computeContextualBanditWeights`; `keep_theta` is forced off internally. */
export type ContextualBanditWeightsInput = {
  varIds: string[];
  attributes: string[];
  maxLeaves: number;
  minUsersPerLeaf: number;
  metricSettings: MetricSettingsForStatsEngine;
  analysisWeights: number[];
  rows: ExperimentMetricQueryResponseRows;
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
 * Binomial metrics are recast to SampleMean for Thompson sampling.
 */
function armMomentStatForBandit(
  arm: ArmColumns,
  metric: MetricSettingsForStatsEngine,
): MomentStat {
  assertSupportedContextualBanditMetric(metric);
  const n = arm.n;
  let stat: SampleMeanStatistic;
  if (metric.main_metric_type === "binomial") {
    stat = new SampleMeanStatistic({
      n,
      sum: arm.main_sum,
      sumSquares: arm.main_sum,
    });
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
  const stats = armsByVariation.map((arm) =>
    armMomentStatForBandit(arm, metric),
  );
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

/**
 * Within-group SSE from each member's per-variation arm statistics: pool the
 * arms per variation, then sum `(n - 1) * variance` across variations.
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
    const stat = armMomentStatForBandit(
      { ...emptyArm(), n, main_sum, main_sum_squares },
      metric,
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
 * single `Float64Array` of length `3 * numVariations`.
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
 * from its sufficient statistics.
 * */
export function armSseDirect(
  n: number,
  sum: number,
  sumSquares: number,
): number {
  if (n <= 1) return 0;
  return sumSquares - (sum * sum) / n;
}

/** Pooled within-group SSE over compact category stats (sums the direct formula). */
function compactGroupSse(cats: CompactCat[], numVariations: number): number {
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
    sse += armSseDirect(n, sum, sumSquares);
  }
  return sse;
}

/**
 * Exact optimal two-group partition of `cats` minimizing total pooled SSE,
 * returned in the same `kMeansResult` shape as `approximateBinaryKMeans`.
 *
 * Optimizations that exploit the exact-two-group structure:
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
): kMeansResult {
  const numCat = cats.length;
  if (numCat < 2) {
    return {
      labels: new Array<number>(numCat).fill(0),
      initIdx: [],
      sse: compactGroupSse(cats, numVariations),
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
        armSseDirect(subN[v], subSum[v], subSq[v]) +
        armSseDirect(
          totalN[v] - subN[v],
          totalSum[v] - subSum[v],
          totalSq[v] - subSq[v],
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
    compactGroupSse(bestSubset, numVariations) +
    compactGroupSse(bestComplement, numVariations);

  // Category 0 is already fixed to group 0 here, but canonicalize for parity
  // with the approximate splitter and to stay robust if that ever changes.
  canonicalizeBinaryLabels(labels);

  return { labels, initIdx: [], sse, converged: true };
}

/**
 * Approximate optimal two-group partition via weighted k-means (Hartigan local
 * search), used when there are too many categories to enumerate exactly.
 *
 * Rather than re-scoring whole groups, this keeps pooled sufficient stats
 * per cluster and scores each candidate move by adding/removing a single
 * category's stats in O(V), so a full pass is O(n·k·V) instead of O(n^2·V).
 *
 * Initializes centriods randomly from the categories (aka Forgy initialization).
 */
function approximateBinaryKMeans(
  cats: CompactCat[],
  numVariations: number,
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
      sse: compactGroupSse(cats, numVariations),
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

  // Forgy seeds: k distinct random categories (partial Fisher-Yates).
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

  // Pin the first category to cluster 0 for deterministic, comparable output.
  canonicalizeBinaryLabels(labels);

  return { labels, initIdx, sse, converged };
}

/** `{ alias: value }` attribute map for a context (values include "Combined"). */
function contextAttrMap(
  ctx: ContextEntry,
  attributes: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  attributes.forEach((alias, i) => {
    map[alias] = ctx.tuple[i];
  });
  return map;
}

/**
 * Build the per-leaf targeting conditions (one entry per tree leaf). Each leaf's
 * `context` is the AND of per-attribute clauses describing the contexts routed to
 * it; a leaf that owns the "Combined" catch-all bucket for an attribute is
 * expressed as the complement of the levels its sibling leaves claim.
 *
 * Only attributes the tree actually split on along a leaf's path
 * (`LeafInfo.pathAttributes`) produce clauses, so the condition mirrors the
 * tree's split logic rather than the leaf's observed context groupings. An
 * attribute the tree never split on is omitted.
 */
function buildLeafConditionMap(
  contexts: ContextEntry[],
  attributes: string[],
  leafInfo: Map<number, LeafInfo>,
): ContextualLeafMapEntry[] {
  const attrMaps = contexts.map((ctx) => contextAttrMap(ctx, attributes));

  return [...leafInfo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([leafId, { memberContexts, pathAttributes }]) => {
      const ownSet = new Set(memberContexts);
      // Attributes the tree split on along this leaf's path, in canonical
      // (attribute-declaration) order.
      const pathAttributeNames = [...pathAttributes]
        .sort((a, b) => a - b)
        .map((attrIndex) => attributes[attrIndex]);
      return {
        leafId,
        context: leafClausesFromContexts(
          memberContexts.map((c) => attrMaps[c]),
          pathAttributeNames,
          attrMaps.filter((_, c) => !ownSet.has(c)),
        ),
      };
    });
}

/**
 * Per-leaf record produced by tree growth: the contexts routed to the leaf
 * (`memberContexts`, indices into `contexts`) and the attribute indices the tree
 * split on along the leaf's root→leaf path (`pathAttributes`).
 */
type LeafInfo = {
  memberContexts: number[];
  pathAttributes: Set<number>;
};

type BuildTreeResult = {
  /** One entry per tree leaf, keyed by leaf id. */
  leafInfo: Map<number, LeafInfo>;
  /**
   * Total within-tree SSE at each stage of greedy growth, in order:
   * index 0 is the root (before the first split), index 1 is after the first
   * split, etc.
   */
  sseTrajectory: number[];
};

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
 * `UpdateWeightsContextualTreeKMeans`).
 * For attributes with at most `MAX_EXHAUSTIVE_CATEGORIES`
 * categories the optimal partition is found exactly (via
 * `bestExhaustiveBinarySplit`); otherwise it falls back to
 * `approximateBinaryKMeans`.
 */
function buildTree(
  contexts: ContextEntry[],
  attributes: string[],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
  maxLeaves: number,
): BuildTreeResult {
  // Sort contexts by their attribute tuple, using the first attribute in
  // `attributes` as the primary key and the remaining attributes as
  // tiebreakers.  Not strictly needed, but helpful for understanding the model.
  const compareContextValues = (a: string, b: string): number => {
    const na = Number(a);
    const nb = Number(b);
    return Number.isNaN(na) || Number.isNaN(nb)
      ? String(a).localeCompare(String(b))
      : na - nb;
  };
  contexts.sort((x, y) => {
    for (let i = 0; i < attributes.length; i++) {
      const cmp = compareContextValues(x.tuple[i], y.tuple[i]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  const currentLeaf = new Array<number>(contexts.length).fill(0);
  // Attribute indices split on along each leaf's root→leaf path. The root leaf
  // (id 0) starts with no path constraints.
  const pathAttrsByLeaf = new Map<number, Set<number>>([
    [0, new Set<number>()],
  ]);
  if (contexts.length === 0) {
    return { leafInfo: new Map(), sseTrajectory: [] };
  }

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

  // Pooled within-leaf SSE over a set of contexts.
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
        sumSquares += isBinomial ? arm.main_sum : arm.main_sum_squares;
      }
      sse += armSseDirect(n, sum, sumSquares);
    }
    return sse;
  };

  // Optimal (or k-means-approximate) binary partition of an attribute's
  // categories: exact subset enumeration when few enough categories, otherwise
  // weighted k-means (Hartigan local search) as an approximate fallback.
  const partitionCategories = (cats: CompactCat[]): kMeansResult =>
    cats.length <= MAX_EXHAUSTIVE_CATEGORIES
      ? bestExhaustiveBinarySplit(cats, numVariations)
      : approximateBinaryKMeans(cats, numVariations, 100);

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
          // Binomial (0/1) data: x^2 = x, so the true sum of squares is `sum`.
          compact[base + CAT_SUM_SQUARES] += isBinomial
            ? arms[v].main_sum
            : arms[v].main_sum_squares;
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
    // Both sides of the split now constrain `bestAttr` along their paths: the
    // new child inherits the parent's path attrs plus this split's attribute,
    // and the retained parent leaf gains it too.
    const parentPathAttrs = pathAttrsByLeaf.get(bestLeaf) ?? new Set<number>();
    pathAttrsByLeaf.set(
      newLeaf,
      new Set<number>([...parentPathAttrs, bestAttr]),
    );
    parentPathAttrs.add(bestAttr);
    pathAttrsByLeaf.set(bestLeaf, parentPathAttrs);

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

  // Combine the two per-leaf facts into a single record per leaf. Seed every
  // leaf from `pathAttrsByLeaf` (so a never-split root gets an empty
  // `pathAttributes` rather than a missing entry), then attach member contexts.
  const leafInfo = new Map<number, LeafInfo>();
  for (const [leafId, pathAttributes] of pathAttrsByLeaf) {
    leafInfo.set(leafId, { memberContexts: [], pathAttributes });
  }
  for (let c = 0; c < currentLeaf.length; c++) {
    leafInfo.get(currentLeaf[c])?.memberContexts.push(c);
  }

  return { leafInfo, sseTrajectory };
}

export function computeContextualBanditWeights(
  input: ContextualBanditWeightsInput,
): ContextualBanditSnapshot {
  const {
    varIds,
    attributes: attributesInput,
    maxLeaves,
    metricSettings: metricSettingsInput,
    analysisWeights,
    rows,
  } = input;

  // Only the first MAX_ATTRIBUTES attributes are included in the analysis.
  const attributes = attributesInput.slice(0, MAX_ATTRIBUTES);

  const metricSettings: MetricSettingsForStatsEngine = {
    ...metricSettingsInput,
    keep_theta: false,
  };

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

  const { leafInfo, sseTrajectory } = buildTree(
    contexts,
    attributes,
    metricSettings,
    numVariations,
    maxLeaves,
  );

  // Forward context→leaf lookup (parallel to `contexts`) for the per-context
  // consumers below; every context belongs to exactly one leaf.
  const leafByContext = new Array<number>(contexts.length);
  for (const [leafId, { memberContexts }] of leafInfo) {
    for (const c of memberContexts) leafByContext[c] = leafId;
  }

  const leafArms = new Map<number, ArmColumns[]>();
  for (let c = 0; c < contexts.length; c++) {
    const leafId = leafByContext[c];
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
        armMomentStatForBandit(arm, metricSettings),
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
    const leafId = leafByContext[c];
    const leaf = leafWeights.get(leafId);

    const contextStats = ctx.arms.map((arm) =>
      armMomentStatForBandit(arm, metricSettings),
    );

    responses.push({
      context: ctx.condition,
      leafId,
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
    leaf_map: buildLeafConditionMap(contexts, attributes, leafInfo),
    leaf_stats,
    sse_trajectory,
  };
}
