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

function toIsoString(d: Date | string | null | undefined): string {
  if (d === null || d === undefined) return new Date(0).toISOString();
  if (typeof d === "string") return d;
  return d.toISOString();
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

export async function projectRevisionSnapshots<
  Snapshot extends object,
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
      baseSnapshot,
      proposedChanges,
    );

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
