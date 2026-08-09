import {
  Revision,
  Review,
  ActivityLogEntry,
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";
import { revisionScheduleApiFields } from "back-end/src/revisions/revisionScheduleApiFields";
import { ApiReqContext } from "back-end/types/api";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";
import { resolveOwnerEmails } from "back-end/src/services/owner";

/**
 * The parts of a revision API response that are the same for every entity.
 *
 * A revision response is a generic envelope — status, reviews, activity log,
 * schedule, resolution, dates — wrapped around an entity payload (`baseX` /
 * `proposedX`). Only the payload differs between Configs, Constants and Saved
 * Groups; the envelope is identical, and was previously written out once per
 * entity.
 *
 * Those copies drifted, in ways nothing caught: `stale` was missing from the
 * Config response entirely, `toIsoString` disagreed about `null`, and the same
 * absent-description test was spelled three ways (one of them a loose `!=`,
 * which this repo forbids). None of that drift tracked a real difference
 * between the entities — it tracked the file boundary.
 *
 * So the envelope lives here once, and each serializer supplies only what is
 * genuinely its own: which model projects the snapshot, and what its two
 * payload fields are called.
 */

/** ISO-8601, treating a missing OR null date as the epoch rather than throwing. */
function toIsoString(d: Date | string | null | undefined): string {
  if ((d ?? null) === null) return new Date(0).toISOString();
  if (typeof d === "string") return d;
  return (d as Date).toISOString();
}

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

function activityLogToApi(entries: ActivityLogEntry[] | undefined) {
  if (!entries) return [];
  return entries.map((e) => ({
    id: e.id,
    userId: e.userId,
    action: e.action,
    ...((e.description ?? null) !== null ? { description: e.description } : {}),
    dateCreated: toIsoString(e.dateCreated),
    ...(e.proposedChangesSnapshot
      ? { proposedChangesSnapshot: e.proposedChangesSnapshot }
      : {}),
    ...(e.targetSnapshot !== undefined
      ? { targetSnapshot: e.targetSnapshot }
      : {}),
  }));
}

/** Every entity-independent field of a revision API response. */
export function revisionEnvelopeToApi(revision: Revision) {
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
    ...revisionScheduleApiFields(revision),
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
  };
}

/**
 * Project each revision's base and proposed snapshots through the entity's own
 * API interface, resolving owner emails for the whole page in ONE batched
 * lookup — the reason list endpoints must go through this rather than calling
 * the single-revision serializer per row.
 */
export async function projectRevisionSnapshots<
  Snapshot,
  ApiShape extends object,
>(
  revisions: Revision[],
  toApiInterface: (snapshot: Snapshot) => ApiShape,
  context: ApiReqContext,
): Promise<
  {
    revision: Revision;
    base: ApiShape;
    proposed: ApiShape;
    proposedChanges: JsonPatchOperation[];
  }[]
> {
  if (revisions.length === 0) return [];

  const prepared = revisions.map((revision) => {
    const baseSnapshot = revision.target.snapshot as Snapshot;
    const proposedChanges: JsonPatchOperation[] = normalizeProposedChanges(
      revision.target.proposedChanges,
    );
    const proposedSnapshot = applyPatchToSnapshot(
      baseSnapshot as Record<string, unknown>,
      proposedChanges,
    ) as Snapshot;

    return {
      revision,
      base: toApiInterface(baseSnapshot),
      proposed: toApiInterface(proposedSnapshot),
      proposedChanges,
    };
  });

  const resolved = await resolveOwnerEmails(
    prepared.flatMap((p) => [p.base, p.proposed]),
    context,
  );

  return prepared.map((p, i) => ({
    ...p,
    base: resolved[i * 2],
    proposed: resolved[i * 2 + 1],
  }));
}
