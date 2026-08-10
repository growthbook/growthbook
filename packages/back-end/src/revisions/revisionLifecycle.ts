import {
  Revision,
  RevisionTargetType,
  REVIEW_CYCLE_STATUSES,
} from "shared/enterprise";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { getAdapter } from "back-end/src/revisions";
import {
  assertCanPublishRevision,
  canRevisionOwnedAction,
  maybeAutoPublishRevision,
} from "back-end/src/revisions/revisionActions";
import {
  draftAuthorityOnRow,
  isRevisionAuthor,
  reviewAuthorityOnRow,
} from "back-end/src/revisions/revisionAuthority";

/** Return a revision that is in review to `draft`, clearing its reviews. */
export async function recallRevisionReview({
  context,
  type,
  revision,
}: {
  context: ApiReqContext;
  type: RevisionTargetType;
  // No `entity`: judged on the revision's own snapshot, not the live entity.
  revision: Revision;
}): Promise<Revision> {
  if (!(REVIEW_CYCLE_STATUSES as readonly string[]).includes(revision.status)) {
    throw new BadRequestError(
      "Only a revision in review can be returned to draft",
    );
  }

  // Lifecycle authority follows the revision snapshot, not later live-entity moves.
  if (
    !isRevisionAuthor(revision.authorId, context.userId) &&
    !canRevisionOwnedAction(context, revision, "draft")
  ) {
    context.permissions.throwPermissionError();
  }

  const recalled = await context.models.revisions.recallReview(
    revision.id,
    context.userId,
    draftAuthorityOnRow(context),
  );
  await getRevisionWebhookAdapter(type)?.dispatch(context, recalled, {
    type: "recalled",
  });
  return recalled;
}

/** Return a discarded revision to `draft` so it can be edited again. */
export async function reopenRevision({
  context,
  type,
  revision,
}: {
  context: ApiReqContext;
  type: RevisionTargetType;
  // No `entity`: judged on the revision's own snapshot, not the live entity.
  revision: Revision;
}): Promise<Revision> {
  if (revision.status !== "discarded") {
    throw new BadRequestError("Only discarded revisions can be reopened");
  }

  if (
    !isRevisionAuthor(revision.authorId, context.userId) &&
    !canRevisionOwnedAction(context, revision, "draft")
  ) {
    context.permissions.throwPermissionError();
  }

  const reopened = await context.models.revisions.reopen(
    revision.id,
    context.userId,
    draftAuthorityOnRow(context),
  );
  await getRevisionWebhookAdapter(type)?.dispatch(context, reopened, {
    type: "reopened",
  });
  return reopened;
}

/** Retract the calling user's own active verdict, returning the draft to review. */
export async function undoRevisionReview({
  context,
  type,
  entity,
  revision,
}: {
  context: ApiReqContext;
  type: RevisionTargetType;
  entity: Record<string, unknown>;
  revision: Revision;
}): Promise<Revision> {
  // Verdict authority follows the revision snapshot and is rechecked inside the CAS.
  if (!canRevisionOwnedAction(context, revision, "review")) {
    context.permissions.throwPermissionError();
  }

  const updated = await context.models.revisions.undoReview(
    revision.id,
    context.userId,
    reviewAuthorityOnRow(context),
    // The cycle this caller was looking at when they asked to retract.
    revision.reviewCycle ?? 0,
  );
  await getRevisionWebhookAdapter(type)?.dispatch(context, updated, {
    type: "reviewRetracted",
  });

  if (updated.status === "approved" && updated.autoPublishOnApproval) {
    return maybeAutoPublishRevision(context, updated, entity);
  }
  return updated;
}

/** Arm a deferred publish, or cancel a pending one when `scheduledPublishAt` is null. */
export async function scheduleRevisionPublish({
  context,
  type,
  entity,
  revision,
  body,
  assertArmable,
}: {
  context: ApiReqContext;
  type: RevisionTargetType;
  entity: Record<string, unknown>;
  revision: Revision;
  body: {
    scheduledPublishAt: string | null;
    lockEdits?: boolean;
    lockOthers?: boolean;
    bypassApproval?: boolean;
  };
  /** Entity-specific arming precondition (a Config refuses while locked). */
  assertArmable?: () => void;
}): Promise<Revision> {
  const { scheduledPublishAt, lockEdits, lockOthers, bypassApproval } = body;
  const isCancel = scheduledPublishAt === null;

  if (
    !isCancel &&
    !(ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status)
  ) {
    throw new BadRequestError(
      "This revision can no longer be scheduled — it was already published or discarded.",
    );
  }

  if (!isCancel) {
    assertArmable?.();
  }

  let parsedDate: Date | null = null;
  if (!isCancel) {
    parsedDate = new Date(scheduledPublishAt);
    if (isNaN(parsedDate.getTime())) {
      throw new BadRequestError("scheduledPublishAt must be a valid date");
    }
    if (parsedDate.getTime() <= Date.now()) {
      throw new BadRequestError("scheduledPublishAt must be in the future");
    }
  }

  const adapter = getAdapter(type);

  // Cancelling needs publish authority; arming additionally needs the
  // scheduled-publish capability (premium feature + that publish authority).
  const canPublish = adapter.canPublishRevision
    ? adapter.canPublishRevision(context, entity)
    : adapter.canUpdate(context, entity);
  const canSchedule = adapter.canSchedulePublish
    ? adapter.canSchedulePublish(context, entity)
    : context.hasPremiumFeature("scheduled-revisions") && canPublish;
  if (isCancel ? !canPublish : !canSchedule) {
    context.permissions.throwPermissionError();
  }
  // Arming uses change-aware publish authority; cancellation remains coarse.
  if (!isCancel) {
    await assertCanPublishRevision(context, revision, entity);
  }

  const wantsBypass =
    !!bypassApproval && adapter.canBypassApproval(context, entity);

  const enabledBy =
    context.userId ||
    revision.autoPublishEnabledBy ||
    revision.authorId ||
    null;
  if (!isCancel && !enabledBy) {
    throw new BadRequestError("A scheduled publish needs a user to run as");
  }

  if (!isCancel && revision.status === "draft" && !wantsBypass) {
    const approvalRequired = adapter.isApprovalRequiredForRevision
      ? adapter.isApprovalRequiredForRevision(context, revision)
      : adapter.isApprovalRequired(context);
    if (approvalRequired) {
      throw new BadRequestError(
        "Request review before scheduling this draft's publish.",
      );
    }
  }

  // Capture guard acknowledgments so fire-time checks can detect drift.
  const armAcknowledgments = isCancel
    ? undefined
    : await adapter.captureArmAcknowledgment?.(
        context,
        entity,
        revision.target.proposedChanges,
      );

  const updated = await context.models.revisions.setScheduledPublish(
    revision.id,
    enabledBy,
    {
      scheduledPublishAt: parsedDate,
      lockEdits,
      lockOthers,
      bypassApproval: wantsBypass,
      armAcknowledgments,
    },
  );

  // Only when the schedule actually moved. `setScheduledPublish` deliberately
  // writes nothing when cancelling an already-disarmed revision, or one a publish
  // or discard has claimed since the read — dispatching there would announce a
  // change this request never made.
  const settled = updated.status === "merged" || updated.status === "discarded";
  if (!settled && !isSameSchedule(revision, updated)) {
    await getRevisionWebhookAdapter(type)?.dispatch(context, updated, {
      type: "publishScheduleChanged",
    });
  }
  return updated;
}

/** The deferred-publish state, for deciding whether a request moved it. */
function isSameSchedule(before: Revision, after: Revision): boolean {
  return (
    !!before.autoPublishOnApproval === !!after.autoPublishOnApproval &&
    (before.scheduledPublishAt?.getTime() ?? null) ===
      (after.scheduledPublishAt?.getTime() ?? null) &&
    !!before.scheduledPublishLockEdits === !!after.scheduledPublishLockEdits &&
    !!before.scheduledPublishLockOthers ===
      !!after.scheduledPublishLockOthers &&
    !!before.scheduledPublishBypassApproval ===
      !!after.scheduledPublishBypassApproval
  );
}
