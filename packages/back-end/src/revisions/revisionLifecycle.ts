import { Revision, RevisionTargetType } from "shared/enterprise";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { getAdapter } from "back-end/src/revisions";
import {
  assertCanPublishRevision,
  canDoRevisionAction,
  maybeAutoPublishRevision,
} from "back-end/src/revisions/revisionActions";
import {
  isRevisionAuthor,
  reviewAuthorityOnRow,
} from "back-end/src/revisions/revisionAuthority";

/**
 * The revision LIFECYCLE verbs — recall a review request, reopen a discarded
 * revision, arm or cancel a deferred publish, retract your own verdict — written
 * once for every entity that has revisions.
 *
 * These four used to exist only on Configs (and, in their own dialect, on Feature
 * Flags), so an API consumer could withdraw a review request on a Config and not on
 * a Constant, for no reason either surface could state. They are per-entity only in
 * how the entity is looked up and rendered, which is what the callers still do; the
 * rules themselves have no business varying by entity, and copying them a third and
 * fourth time is how the last several divergences happened.
 *
 * Each takes an already-loaded entity and revision (the caller resolved the key or
 * id and checked readability), applies the rule, dispatches the lifecycle event via
 * the webhook registry, and returns the updated revision for the caller to render.
 */

const REVIEW_STATUSES = ["pending-review", "changes-requested", "approved"];

/** Return a revision that is in review to `draft`, clearing its reviews. */
export async function recallRevisionReview({
  context,
  type,
  revision,
}: {
  context: ApiReqContext;
  type: RevisionTargetType;
  // No `entity`: this verb is judged on the revision's own snapshot (see below),
  // so the live entity is not part of the decision.
  revision: Revision;
}): Promise<Revision> {
  if (!REVIEW_STATUSES.includes(revision.status)) {
    throw new BadRequestError(
      "Only a revision in review can be returned to draft",
    );
  }

  // Author can always recall their own request; otherwise draft authority, judged
  // on the REVISION's snapshot — the basis the internal controller and the
  // comment/review helpers already use. A revision belongs to the project it was
  // opened in, which a later move on the live entity does not change; asking about
  // live made the two surfaces answer differently for the same revision.
  if (!isRevisionAuthor(revision.authorId, context.userId)) {
    if (
      !canDoRevisionAction(
        type,
        "draft",
        context,
        revision.target.snapshot as Record<string, unknown>,
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }

  const recalled = await context.models.revisions.recallReview(
    revision.id,
    context.userId,
  );
  await getRevisionWebhookAdapter(type)?.dispatch(context, recalled, {
    type: "reopened",
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
  // No `entity`: this verb is judged on the revision's own snapshot (see below),
  // so the live entity is not part of the decision.
  revision: Revision;
}): Promise<Revision> {
  if (revision.status !== "discarded") {
    throw new BadRequestError("Only discarded revisions can be reopened");
  }

  // Authors can always reopen their own drafts; otherwise draft authority, on the
  // revision's snapshot for the same reason as recall above.
  if (!isRevisionAuthor(revision.authorId, context.userId)) {
    if (
      !canDoRevisionAction(
        type,
        "draft",
        context,
        revision.target.snapshot as Record<string, unknown>,
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }

  const reopened = await context.models.revisions.reopen(
    revision.id,
    context.userId,
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
  // Review authority to touch verdicts at all; the model enforces that only the
  // caller's OWN active verdict is retracted.
  //
  // Asked twice on purpose. This is the early, clear refusal against the live entity
  // the caller loaded; `reviewAuthorityOnRow` re-asks it inside the CAS against the
  // revision's own snapshot, so a rebase that moves the revision between the two
  // loses the race rather than carrying the retraction into a project the caller
  // holds nothing in.
  if (!canDoRevisionAction(type, "review", context, entity)) {
    context.permissions.throwPermissionError();
  }

  const updated = await context.models.revisions.undoReview(
    revision.id,
    context.userId,
    reviewAuthorityOnRow(context),
  );
  await getRevisionWebhookAdapter(type)?.dispatch(context, updated, {
    type: "updated",
  });

  // Retracting a request-changes can flip the revision back to approved; if it is
  // armed, auto-publish exactly as the review path does — otherwise the draft sits
  // approved and armed with nothing left to trigger it.
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

  // Only an active draft can be armed; a merged/discarded revision would fail the
  // status-guarded write with a raw Error (500) — reject up front (400).
  if (
    !isCancel &&
    !(ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status)
  ) {
    throw new BadRequestError(
      "This revision can no longer be scheduled — it was already published or discarded.",
    );
  }

  // Arming a future publish is blocked while locked; cancelling a schedule is not.
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
  // Arming takes the same authority the fire-time publish will. The adapter check
  // above is coarse — it cannot see the change set — so without this a caller
  // limited to dev could arm a production-touching schedule and only learn it was
  // refused when the poller fired. Cancelling stays coarse: it withdraws a pending
  // publish rather than landing one.
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

  // Arming a draft that still requires approval (without bypass) isn't allowed —
  // request review first.
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

  // Deferred-publish guards: snapshot the acknowledged conflict keys per guard
  // (throws if arming over live conflicts without ignoreWarnings/bypass). Routed
  // through the adapter so every guard is captured uniformly.
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

  await getRevisionWebhookAdapter(type)?.dispatch(context, updated, {
    type: "updated",
  });
  return updated;
}
