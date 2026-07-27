import {
  Revision,
  Review,
  ActivityLogEntry,
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";
import { ApiSavedGroupRevision } from "shared/validators";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ApiReqContext } from "back-end/types/api";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";
import { resolveOwnerEmails } from "back-end/src/services/owner";

/**
 * Convert internal Review documents into the API-facing shape, ISO-stringifying
 * `dateCreated`. Mirrors how the feature API serializers spread the model's
 * `Date` fields out as strings.
 */
function reviewsToApi(reviews: Review[] | undefined) {
  if (!reviews) return [];
  return reviews.map((r) => ({
    id: r.id,
    userId: r.userId,
    decision: r.decision,
    // Whether a later cycle reset superseded this verdict (no longer active).
    stale: !!r.stale,
    ...(r.comment ? { comment: r.comment } : {}),
    dateCreated: toIsoString(r.dateCreated),
  }));
}

/** Convert internal activity log entries into the API-facing shape. */
function activityLogToApi(entries: ActivityLogEntry[] | undefined) {
  if (!entries) return [];
  return entries.map((e) => ({
    id: e.id,
    userId: e.userId,
    action: e.action,
    ...(e.description != null ? { description: e.description } : {}),
    dateCreated: toIsoString(e.dateCreated),
    ...(e.proposedChangesSnapshot
      ? { proposedChangesSnapshot: e.proposedChangesSnapshot }
      : {}),
    ...(e.targetSnapshot !== undefined
      ? { targetSnapshot: e.targetSnapshot }
      : {}),
  }));
}

function toIsoString(d: Date | string | undefined): string {
  if (d == null) return new Date(0).toISOString();
  if (typeof d === "string") return d;
  return d.toISOString();
}

/**
 * Build the API response payload for a saved-group revision.
 *
 * Hides the raw `target.{snapshot,proposedChanges}` shape used internally and
 * instead surfaces:
 *   - `baseSavedGroup`   — the snapshot at revision-creation time, projected
 *     through `apiSavedGroupValidator`
 *   - `proposedSavedGroup` — the snapshot with `proposedChanges` applied
 *   - `proposedChanges`   — the raw JSON Patch ops (escape hatch for callers
 *     that want to inspect the deltas directly)
 *
 * Owner emails for both projected snapshots are resolved in one batched
 * lookup. For list endpoints, use `toApiSavedGroupRevisions` so the lookup
 * is batched across every revision on the page.
 *
 * Mirrors `toApiRevision` in `services/features.ts` — same input/output
 * relationship, same shape of "hide the model internals, expose a domain view".
 */
export async function toApiSavedGroupRevision(
  revision: Revision,
  context: ApiReqContext,
): Promise<ApiSavedGroupRevision> {
  const [shaped] = await toApiSavedGroupRevisions([revision], context);
  return shaped;
}

export async function toApiSavedGroupRevisions(
  revisions: Revision[],
  context: ApiReqContext,
): Promise<ApiSavedGroupRevision[]> {
  if (revisions.length === 0) return [];

  const prepared = revisions.map((revision) => {
    const baseSnapshot = revision.target.snapshot as SavedGroupInterface;
    const proposedChanges: JsonPatchOperation[] = normalizeProposedChanges(
      revision.target.proposedChanges,
    );
    const proposedSnapshot = applyPatchToSnapshot(
      baseSnapshot,
      proposedChanges,
    ) as SavedGroupInterface;

    const baseApi = context.models.savedGroups.toApiInterface(baseSnapshot);
    const proposedApi =
      context.models.savedGroups.toApiInterface(proposedSnapshot);

    return { revision, baseApi, proposedApi, proposedChanges };
  });

  // Single batched email lookup across every snapshot on the page.
  const flat = prepared.flatMap((p) => [p.baseApi, p.proposedApi]);
  const resolved = await resolveOwnerEmails(flat, context);

  return prepared.map(({ revision, proposedChanges }, i) => {
    const resolvedBase = resolved[i * 2];
    const resolvedProposed = resolved[i * 2 + 1];
    return {
      id: revision.id,
      ...(revision.version !== undefined && { version: revision.version }),
      ...(revision.title ? { title: revision.title } : {}),
      status: revision.status,
      authorId: revision.authorId,
      ...(revision.contributors && revision.contributors.length > 0
        ? { contributors: revision.contributors }
        : {}),
      ...(revision.revertedFrom ? { revertedFrom: revision.revertedFrom } : {}),
      reviews: reviewsToApi(revision.reviews),
      activityLog: activityLogToApi(revision.activityLog),
      ...(revision.resolution
        ? {
            resolution: {
              action: revision.resolution.action,
              userId: revision.resolution.userId,
              dateCreated: toIsoString(revision.resolution.dateCreated),
            },
          }
        : {}),
      dateCreated: toIsoString(revision.dateCreated),
      dateUpdated: toIsoString(revision.dateUpdated),
      baseSavedGroup: resolvedBase,
      proposedSavedGroup: resolvedProposed,
      proposedChanges,
    };
  });
}
