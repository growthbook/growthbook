import {
  Revision,
  Review,
  ActivityLogEntry,
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";
import { ApiConfigRevision } from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { ApiReqContext } from "back-end/types/api";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";
import { resolveOwnerEmails } from "back-end/src/services/owner";

function toIsoString(d: Date | string | undefined): string {
  if (d === undefined) return new Date(0).toISOString();
  if (typeof d === "string") return d;
  return d.toISOString();
}

function reviewsToApi(reviews: Review[] | undefined) {
  if (!reviews) return [];
  return reviews.map((r) => ({
    id: r.id,
    userId: r.userId,
    decision: r.decision,
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

export async function toApiConfigRevision(
  revision: Revision,
  context: ApiReqContext,
): Promise<ApiConfigRevision> {
  const [shaped] = await toApiConfigRevisions([revision], context);
  return shaped;
}

export async function toApiConfigRevisions(
  revisions: Revision[],
  context: ApiReqContext,
): Promise<ApiConfigRevision[]> {
  if (revisions.length === 0) return [];

  const prepared = revisions.map((revision) => {
    const baseSnapshot = revision.target.snapshot as ConfigInterface;
    const proposedChanges: JsonPatchOperation[] = normalizeProposedChanges(
      revision.target.proposedChanges,
    );
    const proposedSnapshot = applyPatchToSnapshot(
      baseSnapshot,
      proposedChanges,
    ) as ConfigInterface;

    const baseApi = context.models.configs.toApiInterface(baseSnapshot);
    const proposedApi = context.models.configs.toApiInterface(proposedSnapshot);

    return { revision, baseApi, proposedApi, proposedChanges };
  });

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
      baseConfig: resolvedBase,
      proposedConfig: resolvedProposed,
      proposedChanges,
    };
  });
}
