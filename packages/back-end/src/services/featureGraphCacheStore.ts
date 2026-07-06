import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";

/**
 * Storage half of the org feature-graph cache (see featureGraphCache.ts for
 * the read path and the caching contract). Lives in its own module so model
 * write hooks can call `invalidateFeatureGraph` without importing the read
 * path, which itself imports the models — keeping the dependency graph
 * acyclic.
 */

export const FEATURE_GRAPH_TTL_MS = 30_000;

// Bound on cached orgs: expired entries are swept opportunistically, and if
// the map is still full of live entries (many-tenant deployment), the
// soonest-expiring one is evicted to make room.
export const FEATURE_GRAPH_MAX_ORGS = 50;

export interface FeatureGraphSnapshot {
  // Migrated, includes archived, NOT permission-filtered.
  features: FeatureInterface[];
  // Projected (stale-graph fields only), includes archived, NOT
  // permission-filtered.
  experiments: ExperimentInterface[];
  mostRecentDraftDateByFeatureId: Map<string, Date>;
  loadedAt: Date;
}

export interface FeatureGraphCacheEntry {
  promise: Promise<FeatureGraphSnapshot>;
  // Infinity while the load is in flight — an unsettled promise is always
  // served, so slow loads coalesce instead of stampeding. Stamped with the
  // real deadline when the load resolves.
  expiresAt: number;
}

export const featureGraphSnapshotCache = new Map<
  string,
  FeatureGraphCacheEntry
>();

/**
 * Drops one org's snapshot (or all of them) so the next read refetches.
 *
 * Called from the feature/experiment write hooks so a writer's next read on
 * the same pod is fresh (session→pod affinity makes that the common case).
 * Being per-process it can never reach sibling pods — other pods serve the
 * old snapshot until their TTL rolls over, so this is a freshness
 * improvement, not a correctness mechanism.
 */
export function invalidateFeatureGraph(orgId?: string): void {
  if (orgId !== undefined) {
    featureGraphSnapshotCache.delete(orgId);
  } else {
    featureGraphSnapshotCache.clear();
  }
}
