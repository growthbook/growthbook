import { isEqual } from "lodash";
import {
  Revision,
  RevisionTargetType,
  checkMergeConflicts,
  normalizeProposedChanges,
  isUserBlockedFromApproving,
  isAutopublishOnApprovalEnabled,
} from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import { buildMergeDesiredState } from "back-end/src/revisions/util";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { BadRequestError, ConflictError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

export async function approveRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
  comment: string,
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);

  if (revision.authorId === context.userId) {
    throw new BadRequestError("Cannot approve a draft you created");
  }

  if (
    context.hasPremiumFeature("require-approvals") &&
    isUserBlockedFromApproving({
      approvalFlows: context.org.settings?.approvalFlows,
      entityType: revision.target.type,
      revision,
      userId: context.userId,
    })
  ) {
    throw new BadRequestError(
      "You contributed to this revision and cannot approve it. A separate reviewer is required.",
    );
  }

  if (!adapter.canUpdate(context, entity)) {
    context.permissions.throwPermissionError();
  }

  if (
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      `Can only approve a revision when review has been requested (status is "${revision.status}")`,
    );
  }

  const updated = await context.models.revisions.addReview(
    revision.id,
    context.userId,
    "approve",
    comment,
  );

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    updated,
    {
      type: "reviewed",
      decision: "approve",
      userId: context.userId,
      ...(comment ? { comment } : {}),
    },
  );

  return updated;
}

export async function publishRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
  { bypass }: { bypass: boolean },
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);

  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    entity,
    normalizeProposedChanges(revision.target.proposedChanges),
  );
  if (!conflictResult.success) {
    throw new ConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  const desiredState = buildMergeDesiredState(
    entity,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  const updatableFields = adapter.getUpdatableFields();
  const hasChanges = Object.keys(desiredState).some((key) => {
    if (!updatableFields.has(key)) return false;
    return !isEqual(desiredState[key], entity[key]);
  });

  if (!hasChanges) {
    const merged = await context.models.revisions.merge(
      revision.id,
      context.userId,
      { bypass },
    );
    await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
      context,
      merged,
      { type: merged.revertedFrom ? "reverted" : "published" },
    );
    return merged;
  }

  await adapter.applyChanges(context, entity, desiredState, {
    isRevert: !!revision.revertedFrom,
  });

  const merged = await context.models.revisions.merge(
    revision.id,
    context.userId,
    { bypass },
  );

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    merged,
    { type: merged.revertedFrom ? "reverted" : "published" },
  );

  return merged;
}

export function canEnableAutoPublishOnApproval(
  context: Context,
  entityType: RevisionTargetType,
  entity: Record<string, unknown>,
): boolean {
  if (!context.hasPremiumFeature("require-approvals")) return false;
  if (
    !isAutopublishOnApprovalEnabled(
      context.org.settings?.approvalFlows,
      entityType,
    )
  ) {
    return false;
  }
  return getAdapter(entityType).canUpdate(context, entity);
}

export async function maybeAutoPublishRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
): Promise<Revision> {
  if (!revision.autoPublishOnApproval) return revision;
  if (revision.status !== "approved") return revision;

  try {
    const enablerContext = await getContextForUserIdInOrg(
      context.org,
      revision.authorId,
    );
    if (!enablerContext) {
      logger.warn(
        { revisionId: revision.id, enablerId: revision.authorId },
        "auto-publish-on-approval skipped: enabling user could not be resolved; revision left approved",
      );
      return revision;
    }

    if (!getAdapter(revision.target.type).canUpdate(enablerContext, entity)) {
      logger.warn(
        { revisionId: revision.id, enablerId: revision.authorId },
        "auto-publish-on-approval skipped: enabling user lacks publish permission; revision left approved",
      );
      return revision;
    }

    return await publishRevision(enablerContext, revision, entity, {
      bypass: false,
    });
  } catch (e) {
    logger.error(
      e,
      `auto-publish-on-approval failed for revision ${revision.id}; left approved for manual publish`,
    );
    return revision;
  }
}
