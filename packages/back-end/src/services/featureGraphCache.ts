import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { fetchAllFeaturesForStaleGraphUnfiltered } from "back-end/src/models/FeatureModel";
import { fetchAllExperimentsForStaleGraphUnfiltered } from "back-end/src/models/ExperimentModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  FEATURE_GRAPH_MAX_ORGS,
  FEATURE_GRAPH_TTL_MS,
  FeatureGraphCacheEntry,
  FeatureGraphSnapshot,
  featureGraphSnapshotCache,
  invalidateFeatureGraph,
} from "back-end/src/services/featureGraphCacheStore";

/**
 * Per-org snapshot of the inputs to the features-UI graph endpoints
 * (`/features/stale`, `/features/dependents`). The UI calls those endpoints
 * once per feature, and each uncached call loads every feature + experiment +
 * active draft revision in the org and blocks the event loop for the whole
 * load+migrate phase — one busy browser session can saturate a pod. The
 * snapshot bounds that to one load per org per TTL window.
 *
 * The cached snapshot is shared across requesters, so it is NOT
 * permission-filtered and MUST stay inside this module; `getOrgFeatureGraph`
 * applies the same per-user project filter the uncached model fetches apply.
 * The returned arrays and Map are per-request copies, but their ELEMENTS are
 * shared across requests — consumers must treat them as read-only.
 *
 * Freshness: feature/experiment write hooks invalidate the writing pod's
 * entry (see featureGraphCacheStore.ts); other pods serve at most
 * TTL+jitter-old data. Responses carry the snapshot's `loadedAt` so clients
 * see the true data age.
 */

export { FEATURE_GRAPH_TTL_MS, invalidateFeatureGraph };

async function loadSnapshot(
  context: ReqContext | ApiReqContext,
): Promise<FeatureGraphSnapshot> {
  // Superset fetch (archived included); getOrgFeatureGraph narrows per
  // request. Nothing here reads requester identity: feature migration uses
  // context.org only, and only featureId/dateUpdated of revisions are kept.
  const [features, experiments, draftRevisions] = await Promise.all([
    fetchAllFeaturesForStaleGraphUnfiltered(context, { includeArchived: true }),
    fetchAllExperimentsForStaleGraphUnfiltered(context, {
      includeArchived: true,
    }),
    getRevisionsByStatus(context as ReqContext, [...ACTIVE_DRAFT_STATUSES], {
      sparse: true,
    }),
  ]);

  const mostRecentDraftDateByFeatureId = new Map<string, Date>();
  for (const rev of draftRevisions) {
    const existing = mostRecentDraftDateByFeatureId.get(rev.featureId);
    const revDate = new Date(rev.dateUpdated ?? 0);
    if (!existing || revDate > existing) {
      mostRecentDraftDateByFeatureId.set(rev.featureId, revDate);
    }
  }

  return {
    features,
    experiments,
    mostRecentDraftDateByFeatureId,
    loadedAt: new Date(),
  };
}

function getSnapshot(
  context: ReqContext | ApiReqContext,
): Promise<FeatureGraphSnapshot> {
  const orgId = context.org.id;
  const now = Date.now();

  const existing = featureGraphSnapshotCache.get(orgId);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  if (featureGraphSnapshotCache.size >= FEATURE_GRAPH_MAX_ORGS) {
    for (const [key, entry] of featureGraphSnapshotCache) {
      if (entry.expiresAt <= now) featureGraphSnapshotCache.delete(key);
    }
    // Still full of live entries (many-tenant deployment): evict the
    // soonest-expiring org so memory stays bounded.
    if (featureGraphSnapshotCache.size >= FEATURE_GRAPH_MAX_ORGS) {
      let evictKey: string | undefined;
      let evictAt = Number.POSITIVE_INFINITY;
      for (const [key, entry] of featureGraphSnapshotCache) {
        if (entry.expiresAt <= evictAt) {
          evictKey = key;
          evictAt = entry.expiresAt;
        }
      }
      if (evictKey !== undefined) featureGraphSnapshotCache.delete(evictKey);
    }
  }

  const entry: FeatureGraphCacheEntry = {
    promise: loadSnapshot(context),
    expiresAt: Number.POSITIVE_INFINITY,
  };
  featureGraphSnapshotCache.set(orgId, entry);
  entry.promise.then(
    () => {
      if (featureGraphSnapshotCache.get(orgId) !== entry) return;
      // Random jitter to avoid synchronized refresh across orgs.
      const jitter = Math.floor(Math.random() * FEATURE_GRAPH_TTL_MS * 0.1);
      entry.expiresAt = Date.now() + FEATURE_GRAPH_TTL_MS + jitter;
    },
    () => {
      // A failed load must not poison the cache — drop it so the next
      // request retries.
      if (featureGraphSnapshotCache.get(orgId) === entry) {
        featureGraphSnapshotCache.delete(orgId);
      }
    },
  );

  return entry.promise;
}

export interface OrgFeatureGraph {
  features: FeatureInterface[];
  experiments: ExperimentInterface[];
  mostRecentDraftDateByFeatureId: Map<string, Date>;
  loadedAt: Date;
}

export async function getOrgFeatureGraph(
  context: ReqContext | ApiReqContext,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<OrgFeatureGraph> {
  const snapshot = await getSnapshot(context);

  // The archived+permission predicate is security-relevant — keep it in one
  // place for both entity kinds.
  const visible = <T extends { archived?: boolean; project?: string }>(
    items: T[],
  ) =>
    items.filter(
      (x) =>
        (includeArchived || !x.archived) &&
        context.permissions.canReadSingleProjectResource(x.project),
    );

  const features = visible(snapshot.features);
  const experiments = visible(snapshot.experiments);

  // Per-request copy, narrowed to features the requester can read — the Map
  // must not expose draft activity (or feature ids) from hidden projects.
  const visibleIds = new Set(features.map((f) => f.id));
  const mostRecentDraftDateByFeatureId = new Map(
    [...snapshot.mostRecentDraftDateByFeatureId].filter(([featureId]) =>
      visibleIds.has(featureId),
    ),
  );

  return {
    features,
    experiments,
    mostRecentDraftDateByFeatureId,
    loadedAt: snapshot.loadedAt,
  };
}
