import type {
  ContextualBanditSnapshot,
  ContextualBanditResponseSnapshot,
  ContextualLeafMapEntry,
  ContextualLeafStatsEntry,
} from "../../types/stats";
import { computeOverallVariationWeights } from "./contextual-bandit-weights";

/** Minimal variation identity needed to label the leaf-first results view. */
export type ContextualBanditResultsVariation = {
  id: string;
  name?: string;
};

export type ContextualBanditOverallVariation = {
  variationId: string;
  variationName?: string;
  /** Marginal (overall) weight across all contexts. */
  weight: number | null;
  /** Total users across all contexts for this variation. */
  users: number | null;
};

export type ContextualBanditLeafVariation = {
  variationId: string;
  variationName?: string;
  /** Leaf decision weight (shared by every context in the leaf). */
  weight: number | null;
  bestArmProbability: number | null;
  /** Leaf-aggregated (pooled) sample stats. */
  users: number | null;
  mean: number | null;
  variance: number | null;
};

export type ContextualBanditContextVariation = {
  variationId: string;
  variationName?: string;
  /** Per-context sample stats; these differ across contexts within a leaf. */
  users: number | null;
  mean: number | null;
  variance: number | null;
};

export type ContextualBanditResultsContext = {
  /** Context attribute values, keyed by attribute alias. */
  attributes: Record<string, string>;
  variations: ContextualBanditContextVariation[];
};

export type ContextualBanditResultsLeaf = {
  leafId: number;
  /** Leaf-level diagnostics (shared by every context in the leaf). */
  updateMessage: string | null;
  error: string | null;
  variations: ContextualBanditLeafVariation[];
  contexts: ContextualBanditResultsContext[];
};

/**
 * Leaf-first view of a contextual-bandit snapshot: one entry per tree leaf
 * (the decision unit), each carrying its weights + pooled stats and the list of
 * contexts that route to it, plus a bandit-level `overall` weight summary.
 */
export type ContextualBanditResultsView = {
  attributes: string[];
  overall: { variations: ContextualBanditOverallVariation[] };
  leaves: ContextualBanditResultsLeaf[];
};

/**
 * Reshape a `ContextualBanditSnapshot` (per-context responses + leaf_map +
 * leaf_stats) into the normalized leaf-first view. `variations` supplies the
 * id/name for each positional slot in the snapshot's per-variation arrays.
 */
export function buildContextualBanditResultsView(
  snapshot: ContextualBanditSnapshot,
  variations: ContextualBanditResultsVariation[],
): ContextualBanditResultsView {
  const responses: ContextualBanditResponseSnapshot[] =
    snapshot.responses ?? [];
  const leafMap: ContextualLeafMapEntry[] = snapshot.leaf_map ?? [];
  const leafStats: ContextualLeafStatsEntry[] = snapshot.leaf_stats ?? [];
  const numVariations = variations.length;

  const meta = (i: number) => ({
    variationId: variations[i]?.id ?? String(i),
    variationName: variations[i]?.name,
  });

  // Group context indices by leaf, preserving first-seen leaf order.
  const indicesByLeaf = new Map<number, number[]>();
  const leafOrder: number[] = [];
  responses.forEach((_, i) => {
    const leafId = leafMap[i]?.leafId ?? 0;
    const existing = indicesByLeaf.get(leafId);
    if (existing) {
      existing.push(i);
    } else {
      indicesByLeaf.set(leafId, [i]);
      leafOrder.push(leafId);
    }
  });

  const leafStatsById = new Map(leafStats.map((s) => [s.leafId, s]));

  const leaves: ContextualBanditResultsLeaf[] = leafOrder
    .sort((a, b) => a - b)
    .map((leafId) => {
      const indices = indicesByLeaf.get(leafId) ?? [];
      // Weights/diagnostics are leaf-level, so any context in the leaf works.
      const head = responses[indices[0]];
      const stats = leafStatsById.get(leafId);

      // Decision weights come strictly from updatedWeights; we do not substitute
      // best-arm probabilities (a different quantity) for them.
      const weights = head?.updatedWeights;
      if (!weights || weights.length === 0) {
        throw new Error(
          `Contextual bandit leaf ${leafId} is missing updatedWeights; cannot build results view.`,
        );
      }

      const leafVariations: ContextualBanditLeafVariation[] = Array.from(
        { length: numVariations },
        (_, i) => ({
          ...meta(i),
          weight: weights[i] ?? null,
          bestArmProbability: head?.bestArmProbabilities?.[i] ?? null,
          users: stats?.sampleSizePerVariation?.[i] ?? null,
          mean: stats?.sampleMeans?.[i] ?? null,
          variance: stats?.sampleVariances?.[i] ?? null,
        }),
      );

      const contexts: ContextualBanditResultsContext[] = indices.map((i) => {
        const row = responses[i];
        return {
          attributes: leafMap[i]?.context ?? {},
          variations: Array.from({ length: numVariations }, (_, j) => ({
            ...meta(j),
            users: row?.sampleSizePerVariation?.[j] ?? null,
            mean: row?.sampleMeans?.[j] ?? null,
            variance: row?.sampleVariances?.[j] ?? null,
          })),
        };
      });

      return {
        leafId,
        updateMessage: head?.updateMessage ?? null,
        error: head?.error ?? null,
        variations: leafVariations,
        contexts,
      };
    });

  const overallWeights = computeOverallVariationWeights(
    responses,
    numVariations,
  );
  const overallVariations: ContextualBanditOverallVariation[] = Array.from(
    { length: numVariations },
    (_, i) => ({
      ...meta(i),
      weight: overallWeights[i] ?? null,
      users: responses.reduce(
        (sum, r) => sum + (r.sampleSizePerVariation?.[i] ?? 0),
        0,
      ),
    }),
  );

  return {
    attributes: snapshot.attributes ?? [],
    overall: { variations: overallVariations },
    leaves,
  };
}
