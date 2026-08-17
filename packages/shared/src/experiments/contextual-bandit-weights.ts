import type { ContextualBanditResponseSnapshot } from "shared/types/stats";

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
 * Sample-size-weighted average of per-context variation weights, i.e. the
 * overall (marginal) weights across every context. Contexts are weighted by
 * their share of total users; when no users are recorded, contexts are weighted
 * uniformly. Returns one entry per variation, `null` when no context
 * contributed a usable weight for that variation.
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
  const contextWeights =
    totalUsers > 0
      ? contextTotals.map((n) => n / totalUsers)
      : responses.map(() => 1 / responses.length);

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
