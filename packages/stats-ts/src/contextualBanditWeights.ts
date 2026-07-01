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
import { varianceOfRatios } from "./utils";

const COMBINED_CONTEXT_ATTRIBUTE_VALUE = "Combined";

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

type BaseStat = {
  sum: number;
  mean: number;
  variance: number;
  isProp: boolean;
};

function sampleMeanStat(sum: number, sumSquares: number, n: number): BaseStat {
  const mean = n === 0 ? 0 : sum / n;
  const variance = n <= 1 ? 0 : (sumSquares - (sum * sum) / n) / (n - 1);
  return { sum, mean, variance, isProp: false };
}

function proportionStat(sum: number, n: number): BaseStat {
  const mean = n === 0 ? 0 : sum / n;
  return { sum, mean, variance: mean * (1 - mean), isProp: true };
}

function baseStatForMetricType(
  metricType: "count" | "binomial" | "quantile" | undefined,
  sum: number,
  sumSquares: number,
  n: number,
): BaseStat {
  if (metricType === "binomial") {
    return proportionStat(sum, n);
  }
  if (metricType === "count") {
    return sampleMeanStat(sum, sumSquares, n);
  }
  throw new Error(
    `Unsupported metric_type for contextual bandit: ${String(metricType)}`,
  );
}

function computeCovariance(
  n: number,
  aSum: number,
  bSum: number,
  sumOfProducts: number,
  bothProportion: boolean,
): number {
  if (n <= 1) return 0;
  if (bothProportion) {
    return sumOfProducts / n - (aSum * bSum) / (n * n);
  }
  return (sumOfProducts - (aSum * bSum) / n) / (n - 1);
}

function armMomentStat(
  arm: ArmColumns,
  metric: MetricSettingsForStatsEngine,
  forBandit: boolean,
): MomentStat {
  const n = arm.n;
  switch (metric.statistic_type) {
    case "mean":
    case "mean_ra": {
      if (metric.main_metric_type === "binomial") {
        const stat = forBandit
          ? sampleMeanStat(arm.main_sum, arm.main_sum, n)
          : proportionStat(arm.main_sum, n);
        return {
          n,
          mean: stat.mean,
          variance: stat.variance,
          unadjustedMean: stat.mean,
          unadjustedVariance: stat.variance,
        };
      }
      const stat = sampleMeanStat(arm.main_sum, arm.main_sum_squares, n);
      return {
        n,
        mean: stat.mean,
        variance: stat.variance,
        unadjustedMean: stat.mean,
        unadjustedVariance: stat.variance,
      };
    }
    case "ratio": {
      const m = baseStatForMetricType(
        metric.main_metric_type,
        arm.main_sum,
        arm.main_sum_squares,
        n,
      );
      const d = baseStatForMetricType(
        metric.denominator_metric_type,
        arm.denominator_sum,
        arm.denominator_sum_squares,
        n,
      );
      const mean = d.sum === 0 ? 0 : m.sum / d.sum;
      const cov = computeCovariance(
        n,
        m.sum,
        d.sum,
        arm.main_denominator_sum_product,
        m.isProp && d.isProp,
      );
      const variance =
        d.mean === 0 || n <= 1
          ? 0
          : varianceOfRatios(m.mean, m.variance, d.mean, d.variance, cov);
      return {
        n,
        mean,
        variance,
        unadjustedMean: mean,
        unadjustedVariance: variance,
      };
    }
    default:
      throw new Error(
        `Unsupported statistic_type for contextual bandit: ${metric.statistic_type}`,
      );
  }
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

function leafSumOfSquaredErrors(
  contexts: ContextEntry[],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
): number {
  let sse = 0;
  for (let v = 0; v < numVariations; v++) {
    let summed = emptyArm();
    for (const ctx of contexts) summed = addArms(summed, ctx.arms[v]);
    const stat = armMomentStat(summed, metric, false);
    sse += (stat.n - 1) * stat.variance;
  }
  return sse;
}

type BuildTreeResult = {
  leafByContext: number[];
  sseTrajectory: number[];
};

function buildTree(
  contexts: ContextEntry[],
  features: Feature[],
  metric: MetricSettingsForStatsEngine,
  numVariations: number,
  maxLeaves: number,
  minUsersPerLeaf: number,
): BuildTreeResult {
  const currentLeaf = new Array<number>(contexts.length).fill(0);
  if (contexts.length === 0) {
    return { leafByContext: currentLeaf, sseTrajectory: [] };
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
      total += leafSumOfSquaredErrors(inLeaf, metric, numVariations);
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
      const sseCurrent = leafSumOfSquaredErrors(
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
          leafSumOfSquaredErrors(
            side0.map((c) => contexts[c]),
            metric,
            numVariations,
          ) +
          leafSumOfSquaredErrors(
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

  return { leafByContext: currentLeaf, sseTrajectory };
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

  const features = buildFeatures(contexts, attrColumns);
  const { leafByContext, sseTrajectory } = buildTree(
    contexts,
    features,
    metricSettings,
    numVariations,
    maxLeaves,
    minUsersPerLeaf,
  );

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
  const leaf_map: ContextualLeafMapEntry[] = [];

  for (let c = 0; c < contexts.length; c++) {
    const ctx = contexts[c];
    const leafId = leafByContext[c];
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

    const leafContext: Record<string, string> = {};
    attributes.forEach((alias, i) => {
      leafContext[alias] = ctx.tuple[i];
    });
    leaf_map.push({ context: leafContext, leafId });
  }

  return {
    attributes,
    responses,
    leaf_map,
    leaf_stats,
    sse_trajectory,
  };
}
