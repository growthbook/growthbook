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
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

export async function approveRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
  comment?: string,
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);
  if (!adapter.canUpdate(context, entity as Record<string, unknown>)) {
    context.permissions.throwPermissionError();
  }

  if (revision.authorId === context.userId) {
    throw new BadRequestError("Cannot approve your own revision");
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
      "You contributed to this revision and cannot approve it.",
    );
  }

  if (
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      `Can only approve when review has been requested (status is "${revision.status}")`,
    );
  }

  const updated = await context.models.revisions.addReview(
    revision.id,
    context.userId,
    "approve",
    comment ?? "",
  );

  await getRevisionWebhookAdapter(updated.target.type)?.dispatch(
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
  { bypass }: { bypass?: boolean } = {},
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);

  if (!adapter.canUpdate(context, entity)) {
    context.permissions.throwPermissionError();
  }

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, revision)
    : adapter.isApprovalRequired(context);
  const canBypass = bypass || adapter.canBypassApproval(context, entity);

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      "The revision must be approved before it can be published",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    entity,
    normalizeProposedChanges(revision.target.proposedChanges),
  );
  if (!conflictResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  // requireRebaseBeforePublish: a diverged revision must rebase first unless the
  // caller can bypass. Gating here covers every internal publish path.
  if (context.org.settings?.requireRebaseBeforePublish && !canBypass) {
    const snapshot = revision.target.snapshot as Record<string, unknown>;
    const diverged = [...adapter.getUpdatableFields()].some(
      (key) => !isEqual(snapshot[key], entity[key]),
    );
    if (diverged) {
      throw new ConflictError(
        "This revision was created against an older version of the entity. " +
          "Rebase the revision first.",
      );
    }
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

  // No net change vs the live entity: either a genuine no-op or a retry after a
  // partial publish (changes applied, merge failed). Close it out as merged
  // rather than erroring, so stranded drafts self-heal. Mirrors
  // postSavedGroupRevisionPublish.
  if (!hasChanges) {
    const merged = await context.models.revisions.merge(
      revision.id,
      context.userId,
      { bypass: isBypass },
    );
    await getRevisionWebhookAdapter(merged.target.type)?.dispatch(
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
    { bypass: isBypass },
  );

  await getRevisionWebhookAdapter(merged.target.type)?.dispatch(
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

  // Publish with the authority of whoever armed auto-publish; fall back to
  // the author for revisions armed before `autoPublishEnabledBy` existed.
  const enablerId = revision.autoPublishEnabledBy ?? revision.authorId;
  if (!enablerId) {
    logger.warn(
      { revisionId: revision.id },
      "auto-publish-on-approval skipped: no arming user or author; left approved",
    );
    return revision;
  }

  try {
    const enablerContext = await getContextForUserIdInOrg(
      context.org,
      enablerId,
    );
    if (!enablerContext) {
      logger.warn(
        { revisionId: revision.id, enablerId },
        "auto-publish-on-approval skipped: enabling user could not be resolved; left approved",
      );
      return revision;
    }

    return await publishRevision(enablerContext, revision, entity);
  } catch (e) {
    logger.error(
      e,
      `auto-publish-on-approval failed for revision ${revision.id}; left approved for manual publish`,
    );
    return revision;
  }
}
