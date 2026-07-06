import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { fetchAllFeaturesForStaleGraphUnfiltered } from "back-end/src/models/FeatureModel";
import { fetchAllExperimentsForStaleGraphUnfiltered } from "back-end/src/models/ExperimentModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

/**
 * Per-org snapshot of the inputs to the features-UI graph endpoints
 * (`/features/stale`, `/features/dependents`). Those endpoints are called
 * once per feature by the UI (single-id N+1), and each uncached call loads
 * every feature + experiment + active draft revision in the org and blocks
 * the event loop for the whole load+migrate phase — one busy browser session
 * can saturate a pod (2026-07-06 StarlingGrowthBookSlowRequestsElevated).
 * The snapshot bounds that to one load per org per TTL window.
 *
 * The cached snapshot is shared across requesters, so it is NOT
 * permission-filtered and MUST stay inside this module; `getOrgFeatureGraph`
 * applies the same per-user project filter the uncached model fetches apply.
 * Writes become visible to these endpoints at most TTL+jitter later — same
 * trade-off as the userEmail cache in services/owner.ts.
 */

export const FEATURE_GRAPH_TTL_MS = 30_000;

// Expired entries for other orgs are only replaced on their next access, so
// sweep opportunistically once the map grows past what a single active
// deployment realistically serves.
const SWEEP_THRESHOLD = 50;

interface FeatureGraphSnapshot {
  // Migrated, includes archived, NOT permission-filtered.
  features: FeatureInterface[];
  // Projected (stale-graph fields only), includes archived, NOT
  // permission-filtered.
  experiments: ExperimentInterface[];
  mostRecentDraftDateByFeatureId: Map<string, Date>;
}

interface CacheEntry {
  promise: Promise<FeatureGraphSnapshot>;
  expiresAt: number;
}

const snapshotCache = new Map<string, CacheEntry>();

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

  return { features, experiments, mostRecentDraftDateByFeatureId };
}

function getSnapshot(
  context: ReqContext | ApiReqContext,
): Promise<FeatureGraphSnapshot> {
  const orgId = context.org.id;
  const now = Date.now();

  const existing = snapshotCache.get(orgId);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  if (snapshotCache.size >= SWEEP_THRESHOLD) {
    for (const [key, entry] of snapshotCache) {
      if (entry.expiresAt <= now) snapshotCache.delete(key);
    }
  }

  // Concurrent cold requests share one in-flight load (the promise is cached
  // immediately, before it settles).
  const promise = loadSnapshot(context);
  // Random jitter to avoid synchronized refresh across orgs.
  const jitter = Math.floor(Math.random() * FEATURE_GRAPH_TTL_MS * 0.1);
  const entry: CacheEntry = {
    promise,
    expiresAt: now + FEATURE_GRAPH_TTL_MS + jitter,
  };
  snapshotCache.set(orgId, entry);
  // A failed load must not poison the whole TTL window — drop it so the next
  // request retries.
  promise.catch(() => {
    if (snapshotCache.get(orgId) === entry) snapshotCache.delete(orgId);
  });

  return promise;
}

export interface OrgFeatureGraph {
  features: FeatureInterface[];
  experiments: ExperimentInterface[];
  mostRecentDraftDateByFeatureId: Map<string, Date>;
}

export async function getOrgFeatureGraph(
  context: ReqContext | ApiReqContext,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<OrgFeatureGraph> {
  const snapshot = await getSnapshot(context);

  const features = snapshot.features.filter(
    (f) =>
      (includeArchived || !f.archived) &&
      context.permissions.canReadSingleProjectResource(f.project),
  );
  const experiments = snapshot.experiments.filter(
    (e) =>
      (includeArchived || !e.archived) &&
      context.permissions.canReadSingleProjectResource(e.project),
  );

  return {
    features,
    experiments,
    mostRecentDraftDateByFeatureId: snapshot.mostRecentDraftDateByFeatureId,
  };
}

/** Drops one org's snapshot (or all of them) so the next read refetches. */
export function invalidateFeatureGraph(orgId?: string): void {
  if (orgId !== undefined) {
    snapshotCache.delete(orgId);
  } else {
    snapshotCache.clear();
  }
}
