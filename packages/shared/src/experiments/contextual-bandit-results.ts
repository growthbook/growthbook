import type { ContextualBanditVariationStatus } from "shared/validators";
import type {
  ContextualBanditSnapshot,
  ContextualBanditResponseSnapshot,
  ContextualLeafClause,
  ContextualLeafMapEntry,
  ContextualLeafStatsEntry,
  ContextualSseTrajectoryEntry,
  ContextualTreeSplit,
} from "shared/types/stats";
import {
  computeOverallVariationMeans,
  computeOverallVariationWeights,
} from "./contextual-bandit-weights";
import { isActiveVariation } from "./contextual-bandit-variation-changes";

/** Minimal variation identity needed to label the leaf-first results view. */
export type ContextualBanditResultsVariation = {
  id: string;
  name?: string;
};
export function resolveSnapshotVariations(
  frozenVariationIds: readonly string[],
  currentVariations: readonly { id: string; name?: string }[],
): ContextualBanditResultsVariation[] {
  const byId = new Map(currentVariations.map((v) => [v.id, v]));
  return frozenVariationIds.map((id) => ({ id, name: byId.get(id)?.name }));
}

export type ContextualBanditOverallVariation = {
  variationId: string;
  variationName?: string;
  weight: number | null;
  /**
   * Population-weighted mean outcome for this variation across all contexts:
   * the expected outcome if this variation served the entire population.
   */
  mean: number | null;
  users: number | null;
};

export type ContextualBanditLeafVariation = {
  variationId: string;
  variationName?: string;
  weight: number | null;
  bestArmProbability: number | null;
  users: number | null;
  mean: number | null;
  variance: number | null;
};

export type ContextualBanditContextVariation = {
  variationId: string;
  variationName?: string;
  users: number | null;
  mean: number | null;
  variance: number | null;
};

export type ContextualBanditResultsContext = {
  attributes: Record<string, string>;
  variations: ContextualBanditContextVariation[];
};

export type ContextualBanditResultsLeaf = {
  leafId: number;
  updateMessage: string | null;
  error: string | null;
  /** Per-attribute targeting clauses defining the leaf (AND-ed together). */
  clauses: ContextualLeafClause[];
  variations: ContextualBanditLeafVariation[];
  contexts: ContextualBanditResultsContext[];
};

/**
 * Within-tree SSE at one stage of greedy tree growth, summed over eligible
 * variations only (those with enough units to enter tree construction). This is
 * an "eligible-only" error rather than a total across all observed variations.
 */
export type ContextualBanditSseStep = {
  numSplits: number;
  totalSse: number;
  /**
   * Metadata for the split that produced this stage. Absent on the root stage
   * (`numSplits === 0`), where no split has been applied yet.
   */
  split?: ContextualTreeSplit;
};

/**
 * Leaf-first view of a contextual-bandit snapshot: one entry per tree leaf
 * (the decision unit), each carrying its weights + pooled stats and the list of
 * contexts that route to it, plus a bandit-level `overall` weight summary.
 */
export type ContextualBanditResultsView = {
  attributes: string[];
  sseTrajectory: ContextualBanditSseStep[];
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
  const sseTrajectorySnapshot: ContextualSseTrajectoryEntry[] =
    snapshot.sse_trajectory ?? [];
  const numVariations = variations.length;

  const meta = (i: number) => ({
    variationId: variations[i]?.id ?? String(i),
    variationName: variations[i]?.name,
  });

  const indicesByLeaf = new Map<number, number[]>();
  const leafOrder: number[] = [];
  responses.forEach((response, i) => {
    const leafId = response.leafId ?? 0;
    const existing = indicesByLeaf.get(leafId);
    if (existing) {
      existing.push(i);
    } else {
      indicesByLeaf.set(leafId, [i]);
      leafOrder.push(leafId);
    }
  });

  const leafStatsById = new Map(leafStats.map((s) => [s.leafId, s]));
  const clausesByLeaf = new Map(leafMap.map((e) => [e.leafId, e.context]));

  const contextAttributes = (
    response: ContextualBanditResponseSnapshot | undefined,
  ): Record<string, string> => {
    const attributes: Record<string, string> = {};
    Object.entries(response?.context ?? {}).forEach(([key, value]) => {
      if ((value ?? null) !== null) attributes[key] = String(value);
    });
    return attributes;
  };

  const leaves: ContextualBanditResultsLeaf[] = leafOrder
    .sort((a, b) => a - b)
    .map((leafId) => {
      const indices = indicesByLeaf.get(leafId) ?? [];
      const head = responses[indices[0]];
      const stats = leafStatsById.get(leafId);

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
          attributes: contextAttributes(row),
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
        clauses: clausesByLeaf.get(leafId) ?? [],
        variations: leafVariations,
        contexts,
      };
    });

  const overallWeights = computeOverallVariationWeights(
    responses,
    numVariations,
  );
  const overallMeans = computeOverallVariationMeans(responses, numVariations);
  const overallVariations: ContextualBanditOverallVariation[] = Array.from(
    { length: numVariations },
    (_, i) => ({
      ...meta(i),
      weight: overallWeights[i] ?? null,
      mean: overallMeans[i] ?? null,
      users: responses.reduce(
        (sum, r) => sum + (r.sampleSizePerVariation?.[i] ?? 0),
        0,
      ),
    }),
  );

  const sseTrajectory: ContextualBanditSseStep[] = sseTrajectorySnapshot.map(
    (step) => ({
      numSplits: step.numSplits,
      totalSse: step.totalSse,
      ...(step.split ? { split: step.split } : {}),
    }),
  );

  return {
    attributes: snapshot.attributes ?? [],
    sseTrajectory,
    overall: { variations: overallVariations },
    leaves,
  };
}

export type ContextualBanditVariationIdentity = {
  id: string;
  key: string;
  status?: ContextualBanditVariationStatus;
};

export type UnknownVariationCause =
  | { kind: "empty"; value: string }
  | { kind: "caseOrWhitespace"; value: string; expectedKey: string }
  | { kind: "growthbookId"; value: string; expectedKey?: string }
  | { kind: "index"; value: string; expectedKey?: string }
  | { kind: "unrecognized"; value: string };

const normalizeVariationValue = (value: string): string =>
  value.trim().toLowerCase();

export function classifyUnknownVariation(
  value: string,
  variations: ContextualBanditVariationIdentity[],
): UnknownVariationCause {
  if (value === "") {
    return { kind: "empty", value };
  }

  const byId = variations.find((v) => v.id === value);
  if (byId) {
    return { kind: "growthbookId", value, expectedKey: byId.key };
  }
  if (/^var_/.test(value)) {
    return { kind: "growthbookId", value };
  }

  const normalized = normalizeVariationValue(value);
  const byNormalizedKey = variations.find(
    (v) => normalizeVariationValue(v.key) === normalized,
  );
  if (byNormalizedKey) {
    return {
      kind: "caseOrWhitespace",
      value,
      expectedKey: byNormalizedKey.key,
    };
  }

  if (/^\d+$/.test(value)) {
    const index = Number(value);
    const activeVariations = variations.filter(isActiveVariation);
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < activeVariations.length
    ) {
      return {
        kind: "index",
        value,
        expectedKey: activeVariations[index]?.key,
      };
    }
  }

  return { kind: "unrecognized", value };
}

export function classifyUnknownVariations(
  values: string[],
  variations: ContextualBanditVariationIdentity[],
): UnknownVariationCause[] {
  return values.map((value) => classifyUnknownVariation(value, variations));
}
