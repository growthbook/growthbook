import { isEqual } from "lodash";
import {
  Revision,
  RevisionTargetType,
  checkMergeConflicts,
  normalizeProposedChanges,
  isUserBlockedFromApproving,
  isAutopublishOnApprovalEnabled,
  isScheduledPublishPending,
  isScheduledPublishDue,
} from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  TerminalPublishError,
  isTerminalPublishError,
  getErrorMessage,
} from "back-end/src/util/errors";
import { decideScheduledPublishOutcome } from "back-end/src/revisions/publishFailurePolicy";
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
      settings: context.org.settings,
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
  { bypass, deferred }: { bypass?: boolean; deferred?: boolean } = {},
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);

  // Publish authority may be narrower than update (e.g. environment-scoped);
  // honor the adapter override when present, like the schedule controller does.
  const canPublish = adapter.canPublishRevision
    ? adapter.canPublishRevision(context, entity)
    : adapter.canUpdate(context, entity);
  if (!canPublish) {
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
    adapter.getUpdatableFields(),
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
    const diverged = isRevisionDiverged(
      adapter,
      revision.target.snapshot as Record<string, unknown>,
      entity,
    );
    if (diverged) {
      throw new ConflictError(
        "This revision was created against an older version of the entity. " +
          "Rebase the revision first.",
      );
    }
  }

  // Another draft's committed "lock other drafts" schedule blocks this publish.
  // Excludes this revision by id, so the locking revision can still fire itself.
  if (
    await context.models.revisions.hasPublishLockingScheduledSibling(
      revision.target,
      revision.id,
    )
  ) {
    throw new BadRequestError(
      "Another draft of this entity has a scheduled publish that locks other drafts. Cancel that schedule to publish this revision.",
    );
  }

  const desiredState = buildMergeDesiredState(
    entity,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // The check above covers the live (source) entity. If the revision moves the
  // entity to a different project, also require update permission on the
  // destination — publishing a project move must not land where the caller
  // lacks access.
  if (!adapter.canUpdate(context, { ...entity, ...desiredState })) {
    context.permissions.throwPermissionError();
  }

  const updatableFields = adapter.getUpdatableFields();
  const hasChanges = Object.keys(desiredState).some((key) => {
    if (!updatableFields.has(key)) return false;
    return !isEqual(desiredState[key], entity[key]);
  });

  // Validate BEFORE claiming the merge so a publish that fails validation (e.g. a
  // config value violating a cross-field rule) errors without ever marking the
  // revision merged — it stays open and editable. A bypass/admin-override publish
  // skips approval, not validation. Runs even for the no-op branch below —
  // publishing (including a no-op merge) is the gated action, and e.g. a locked
  // config must not have its latest-merged pointer advanced past the pin.
  await adapter.assertPublishable?.(context, entity, desiredState, revision, {
    isRevert: !!revision.revertedFrom,
    deferred: !!deferred,
  });

  // No net change vs the live entity: either a genuine no-op or a retry after a
  // partial publish (changes applied, merge failed). Close it out as merged
  // rather than erroring, so stranded drafts self-heal. Mirrors
  // postSavedGroupRevisionPublish.
  if (!hasChanges) {
    // Runs before the merge so a failure leaves the draft open and retryable.
    await adapter.beforeNoOpMerge?.(context, entity, revision);
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

  // Claim the merge BEFORE touching the live entity. `merge` is CAS-guarded, so
  // a concurrent discard either lost (status already moved → merge throws here,
  // nothing applied) or will lose (its `close` CAS-fails once we've merged).
  // This closes the window where a discard landing between applyChanges and
  // merge would orphan a half-applied change on the live entity.
  const merged = await context.models.revisions.merge(
    revision.id,
    context.userId,
    { bypass: isBypass },
  );

  try {
    await adapter.applyChanges(context, entity, desiredState, {
      isRevert: !!revision.revertedFrom,
    });
  } catch (e) {
    // Couldn't apply after claiming the merge — roll back to the pre-merge
    // state so the revision isn't stranded "merged" with the live entity
    // unchanged. Restores status AND any schedule `merge` scrubbed, so a
    // fire-time failure holds for the poller's next tick instead of silently
    // killing the schedule. A retry then re-runs the full publish (and the
    // no-op self-heal path above if it was partially applied). Best-effort:
    // surface the original error regardless.
    try {
      const restored = await context.models.revisions.reopenAfterFailedApply(
        merged.id,
        context.userId,
        revision,
      );
      if (!restored) {
        await context.models.revisions.reopen(merged.id, context.userId);
      }
    } catch {
      // ignore — the original applyChanges error is the one that matters
    }
    throw e;
  }

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
  const adapter = getAdapter(entityType);
  // The adapter may override how autopublish-on-approval is determined
  // (constants key off the feature `requireReviews` model). Default to the
  // entity's approval-flow toggle.
  const enabled = adapter.isAutopublishOnApprovalEnabled
    ? adapter.isAutopublishOnApprovalEnabled(context, entity)
    : isAutopublishOnApprovalEnabled(
        context.org.settings,
        entityType,
        (entity as { project?: string }).project,
      );
  if (!enabled) return false;
  return adapter.canUpdate(context, entity);
}

export async function maybeAutoPublishRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
): Promise<Revision> {
  if (!revision.autoPublishOnApproval) return revision;
  if (revision.status !== "approved") return revision;

  // A future-dated schedule defers the publish to the poller — don't fire early
  // just because approval landed.
  if (isScheduledPublishPending(revision) && !isScheduledPublishDue(revision)) {
    return revision;
  }

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

    // Deferred: the guard override was acknowledged at arm time (fingerprint on
    // the revision), not by whoever triggered this approval.
    return await publishRevision(enablerContext, revision, entity, {
      deferred: true,
    });
  } catch (e) {
    logger.error(
      e,
      `auto-publish-on-approval failed for revision ${revision.id}; left approved for manual publish`,
    );
    // Terminal failures notify a human and disarm (this path has no poller retry
    // loop); transient failures stay approved for a manual publish, no webhook.
    if (isTerminalPublishError(e)) {
      // Disarm so a later trigger (re-approval, undo, rebase) doesn't re-run the
      // doomed publish and re-fire the webhook; also clears the stale fingerprint.
      let disarmed = revision;
      try {
        disarmed = await context.models.revisions.setAutoPublishOnApproval(
          revision.id,
          context.userId,
          false,
        );
      } catch {
        // best-effort — still fire the webhook below
      }
      await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
        context,
        disarmed,
        {
          type: "publishFailed",
          reason: getErrorMessage(e),
          terminal: true,
          attempts: 1,
        },
      );
      return disarmed;
    }
    return revision;
  }
}

// Record a failed scheduled-publish attempt and decide what happens next: retry
// after a backoff, or give up (park the draft + fire `revision.publishFailed`).
// Terminal failures give up on the first attempt; transient ones retry up to the
// cap. See publishFailurePolicy for the decision logic.
async function handleScheduledPublishFailure(
  context: Context,
  revision: Revision,
  error: unknown,
): Promise<void> {
  const message = getErrorMessage(error);
  const attempts = await context.models.revisions.recordScheduledPublishFailure(
    revision.id,
    message,
  );
  const outcome = decideScheduledPublishOutcome({
    error,
    attempts,
    now: new Date(),
  });

  if (outcome.action === "retry") {
    await context.models.revisions.setScheduledPublishNextAttempt(
      revision.id,
      outcome.nextAttemptAt,
    );
    logger.info(
      {
        revisionId: revision.id,
        attempts,
        nextAttemptAt: outcome.nextAttemptAt,
      },
      `Scheduled publish held (retry after backoff): ${message}`,
    );
    return;
  }

  // Give up: stop the poller retrying and notify a human.
  const terminal = outcome.classification === "terminal";
  await context.models.revisions.parkScheduledPublish(revision.id);
  logger.error(
    { revisionId: revision.id, attempts, terminal },
    `Scheduled publish gave up (${terminal ? "terminal failure" : "max attempts reached"}): ${message}`,
  );
  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "publishFailed", reason: message, terminal, attempts },
  );
}

/**
 * Poller entry point: publish a due scheduled revision with the arming user's
 * authority. Re-checks the due gate and governance (approval, conflicts, rebase,
 * sibling locks all live in publishRevision); on any failure records the attempt
 * and holds so the poller retries next tick.
 */
export async function maybePublishScheduledRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
): Promise<Revision> {
  if (!isScheduledPublishDue(revision)) return revision;

  // Respect the backoff window between transient retries.
  if (
    revision.scheduledPublishNextAttemptAt &&
    revision.scheduledPublishNextAttemptAt > new Date()
  ) {
    return revision;
  }

  const enablerId = revision.autoPublishEnabledBy ?? revision.authorId;
  if (!enablerId) {
    // No user to ever publish as — terminal, don't retry.
    await handleScheduledPublishFailure(
      context,
      revision,
      new TerminalPublishError("No arming user or author to publish with"),
    );
    return revision;
  }

  try {
    const enablerContext = await getContextForUserIdInOrg(
      context.org,
      enablerId,
    );
    if (!enablerContext) {
      // Transient: the user may resolve on a later tick.
      await handleScheduledPublishFailure(
        context,
        revision,
        new Error("Arming user could not be resolved"),
      );
      return revision;
    }

    // Admin bypass-approval is only honored if the armer STILL holds bypass at
    // fire time (a lapsed admin can't force a non-bypass schedule through).
    const adapter = getAdapter(revision.target.type);
    const bypass =
      !!revision.scheduledPublishBypassApproval &&
      adapter.canBypassApproval(enablerContext, entity);

    return await publishRevision(enablerContext, revision, entity, {
      bypass,
      deferred: true,
    });
  } catch (e) {
    await handleScheduledPublishFailure(context, revision, e);
    return revision;
  }
}
