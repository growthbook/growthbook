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
  MultivariateKMeans,
  ExhaustiveBinaryKMeans,
  MAX_EXHAUSTIVE_CATEGORIES,
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
 */
function sumOfSquaredErrorsFromArms(
  armsPerMember: ArmColumns[][],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
): number {
  let sse = 0;
  for (let v = 0; v < numVariations; v++) {
    let summed = emptyArm();
    for (const arms of armsPerMember) summed = addArms(summed, arms[v]);
    const stat = armMomentStat(summed, metric, false);
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

/** Summed arms per variation across a set of contexts. */
function sumArmsByVariation(
  contexts: ContextEntry[],
  numVariations: number,
): ArmColumns[] {
  const arms = Array.from({ length: numVariations }, emptyArm);
  for (const ctx of contexts) {
    for (let v = 0; v < numVariations; v++) {
      arms[v] = addArms(arms[v], ctx.arms[v]);
    }
  }
  return arms;
}

/**
 * Greedy SSE regression tree up to `maxLeaves` where each split groups one
 * attribute's categories into two sets via weighted k-means (porting gbstats
 * `UpdateWeightsContextualTreeKMeans`). This admits multi-category splits like
 * `country in (US, CA)` vs not, rather than only `country == US` vs not.
 *
 * A split is taken only when the best available (non-degenerate) binary
 * category partition strictly reduces total SSE; there is no minimum-users-
 * per-leaf guard. For attributes with at most `MAX_EXHAUSTIVE_CATEGORIES`
 * categories the optimal partition is found exactly; otherwise it falls back to
 * `MultivariateKMeans`, whose Forgy initialization uses `Math.random`, so those
 * partitions (and hence the tree) are not reproducible across runs.
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

  // Objective used to grow the tree: every SSE used for split selection
  // (current leaf, candidate split, trajectory) goes through this metric.
  const clusterMetric = metric;

  const totalSse = (): number => {
    let total = 0;
    for (const leafId of new Set(currentLeaf)) {
      const inLeaf: ContextEntry[] = [];
      for (let c = 0; c < contexts.length; c++) {
        if (currentLeaf[c] === leafId) inLeaf.push(contexts[c]);
      }
      total += sumOfSquaredErrors(inLeaf, clusterMetric, numVariations);
    }
    return total;
  };

  const sseTrajectory: number[] = [totalSse()];

  for (let iteration = 0; iteration < maxLeaves - 1; iteration++) {
    let bestGain = -Infinity;
    let bestAttr = -1;
    let bestLeaf = -1;
    let bestGroup: Set<string> = new Set();

    const leafIds = [...new Set(currentLeaf)].sort((a, b) => a - b);
    // Parallel per-leaf arrays (indexed like `leafIds`), kept for transparency:
    // each leaf's SSE before splitting, and the lowest SSE achievable by
    // splitting it (stays Infinity when the leaf admits no valid split).
    const sseCurrent = new Array<number>(leafIds.length).fill(0);
    const sseSplit = new Array<number>(leafIds.length).fill(Infinity);

    for (let leafIndex = 0; leafIndex < leafIds.length; leafIndex++) {
      const leafId = leafIds[leafIndex];
      const inLeaf: number[] = [];
      for (let c = 0; c < contexts.length; c++) {
        if (currentLeaf[c] === leafId) inLeaf.push(c);
      }
      sseCurrent[leafIndex] = sumOfSquaredErrors(
        inLeaf.map((c) => contexts[c]),
        clusterMetric,
        numVariations,
      );

      for (let attrIndex = 0; attrIndex < attributes.length; attrIndex++) {
        // Unique categories of this attribute within the leaf (sorted for
        // stable point ordering).
        const categories = [
          ...new Set(inLeaf.map((c) => contexts[c].tuple[attrIndex])),
        ].sort();
        if (categories.length < 2) continue;

        // Per-category statistics: the pooled per-variation arms for each
        // distinct category of this attribute within the leaf. These are the
        // additive sufficient stats SSE is computed from.
        const categoryArms: ArmColumns[][] = categories.map((category) =>
          sumArmsByVariation(
            inLeaf
              .filter((c) => contexts[c].tuple[attrIndex] === category)
              .map((c) => contexts[c]),
            numVariations,
          ),
        );

        // Both clusterers minimize the same real pooled-SSE objective over the
        // per-category statistics. With few enough categories, find the optimal
        // binary split exactly by enumerating all subsets; otherwise approximate
        // it with weighted k-means (Hartigan local search).
        const groupSse = (group: ArmColumns[][]): number =>
          sumOfSquaredErrorsFromArms(group, clusterMetric, numVariations);

        const km =
          categories.length <= MAX_EXHAUSTIVE_CATEGORIES
            ? new ExhaustiveBinaryKMeans<ArmColumns[]>().fit(
                categoryArms,
                groupSse,
              )
            : new MultivariateKMeans<ArmColumns[]>(2, 100).fit(
                categoryArms,
                groupSse,
              );
        const labels = km.labels;

        const group = new Set(categories.filter((_, i) => labels[i] === 1));
        // Both sides must be non-empty for a real split.
        if (group.size === 0 || group.size === categories.length) continue;

        // The clusterer already minimized this same pooled-SSE objective over
        // the category statistics, so its achieved SSE is the split SSE (pooling
        // a group's category arms is identical to pooling that group's contexts).
        const candidateSseSplit = km.sse;

        // Record the best (lowest) split SSE found for this leaf.
        if (candidateSseSplit < sseSplit[leafIndex]) {
          sseSplit[leafIndex] = candidateSseSplit;
        }

        const gain = sseCurrent[leafIndex] - candidateSseSplit;
        if (gain > bestGain) {
          bestGain = gain;
          bestAttr = attrIndex;
          bestLeaf = leafId;
          bestGroup = group;
        }
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
