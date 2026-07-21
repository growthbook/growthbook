import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";

/**
 * Storage half of the org feature-graph cache (see featureGraphCache.ts for
 * the read path and the caching contract). Lives in its own module so model
 * write hooks can call `invalidateFeatureGraph` without importing the read
 * path, which itself imports the models — keeping the dependency graph
 * acyclic.
 */

// Env knobs live in util/secrets.ts alongside the other tunables
// (FEATURE_GRAPH_CACHE_TTL_MS, FEATURE_GRAPH_LOAD_TIMEOUT_MS); re-exported
// here so cache consumers and tests have one import site.
export {
  FEATURE_GRAPH_CACHE_TTL_MS,
  FEATURE_GRAPH_LOAD_TIMEOUT_MS,
} from "back-end/src/util/secrets";

// Bound on cached orgs: expired entries are swept opportunistically, and if
// the map is still full of live entries (many-tenant deployment), the
// least-recently-hit one is evicted to make room.
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
  // Updated on every served hit; drives least-recently-hit eviction so a
  // full map drops cold orgs, not the warm ones about to be re-read.
  lastHitAt: number;
}

export const featureGraphSnapshotCache = new Map<
  string,
  FeatureGraphCacheEntry
>();

/**
 * Drops one org's snapshot (or all of them) so the next read refetches.
 *
 * Called from the feature/experiment/revision write hooks. Per-process and
 * best-effort: it only helps when the writer's next read lands on the
 * writing pod, which without session affinity is a 1-in-N chance behind a
 * round-robin balancer. Other pods serve the old snapshot until their TTL
 * rolls over — this is a freshness improvement, not a correctness mechanism;
 * the TTL is the staleness bound.
 */
export function invalidateFeatureGraph(orgId?: string): void {
  if (orgId !== undefined) {
    featureGraphSnapshotCache.delete(orgId);
  } else {
    featureGraphSnapshotCache.clear();
  }
}
