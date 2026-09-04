import type { ContextualBanditResponseSnapshot } from "../../types/stats";

/** Total users observed for a single context (sum of per-variation sample sizes). */
export function contextTotalSampleSize(
  row: ContextualBanditResponseSnapshot,
): number {
  const sizes = row.sampleSizePerVariation;
  if (!sizes?.length) return 0;
  return sizes.reduce((sum, n) => sum + (n ?? 0), 0);
}

function contextVariationWeights(
  row: ContextualBanditResponseSnapshot,
  numVariations: number,
): (number | null)[] {
  const source = row.updatedWeights;
  if (!source || source.length === 0) {
    throw new Error(
      "Contextual bandit context is missing updatedWeights; cannot compute overall variation weights.",
    );
  }
  return Array.from({ length: numVariations }, (_, i) =>
    source[i] !== undefined && source[i] !== null ? Number(source[i]) : null,
  );
}

/**
 * Sample-size-weighted average of per-context variation weights. Returns `null`
 * for every variation when no per-context sample sizes are recorded, since the
 * contexts cannot be weighted without them.
 *
 * Throws if any context is missing `updatedWeights`.
 */
export function computeOverallVariationWeights(
  responses: ContextualBanditResponseSnapshot[],
  numVariations: number,
): (number | null)[] {
  if (!responses.length || numVariations === 0) {
    return Array(numVariations).fill(null);
  }

  const contextTotals = responses.map(contextTotalSampleSize);
  const totalUsers = contextTotals.reduce((sum, n) => sum + n, 0);
  if (totalUsers <= 0) {
    return Array(numVariations).fill(null);
  }
  const contextWeights = contextTotals.map((n) => n / totalUsers);

  const overall: number[] = Array(numVariations).fill(0);
  const hasContribution = Array(numVariations).fill(false);

  responses.forEach((row, c) => {
    const variationWeights = contextVariationWeights(row, numVariations);
    const contextWeight = contextWeights[c];
    variationWeights.forEach((w, j) => {
      if (w !== null && !Number.isNaN(w)) {
        overall[j] += contextWeight * w;
        hasContribution[j] = true;
      }
    });
  });

  return overall.map((v, j) => (hasContribution[j] ? v : null));
}

/**
 * Population-weighted average of per-context variation means. Returns `null`
 * for every variation when no per-context sample sizes are recorded, since the
 * contexts cannot be weighted without them.
 */
export function computeOverallVariationMeans(
  responses: ContextualBanditResponseSnapshot[],
  numVariations: number,
): (number | null)[] {
  if (!responses.length || numVariations === 0) {
    return Array(numVariations).fill(null);
  }

  const contextTotals = responses.map(contextTotalSampleSize);
  const totalUsers = contextTotals.reduce((sum, n) => sum + n, 0);
  if (totalUsers <= 0) {
    return Array(numVariations).fill(null);
  }
  const contextWeights = contextTotals.map((n) => n / totalUsers);

  const weightedSum: number[] = Array(numVariations).fill(0);
  const weightNorm: number[] = Array(numVariations).fill(0);

  responses.forEach((row, c) => {
    const means = row.sampleMeans;
    if (!means) return;
    const contextWeight = contextWeights[c];
    for (let j = 0; j < numVariations; j++) {
      const mean = means[j];
      if (mean !== undefined && mean !== null && !Number.isNaN(mean)) {
        weightedSum[j] += contextWeight * Number(mean);
        weightNorm[j] += contextWeight;
      }
    }
  });

  return weightedSum.map((sum, j) =>
    weightNorm[j] > 0 ? sum / weightNorm[j] : null,
  );
}
