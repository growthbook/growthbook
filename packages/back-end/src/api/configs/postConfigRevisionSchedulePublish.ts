import {
  ACTIVE_DRAFT_STATUSES,
  postConfigRevisionSchedulePublishValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionSchedulePublish = createApiRequestHandler(
  postConfigRevisionSchedulePublishValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  const { scheduledPublishAt, lockEdits, lockOthers, bypassApproval } =
    req.body;
  const isCancel = scheduledPublishAt === null;

  // Only an active draft can be armed; a merged/discarded revision would fail
  // the status-guarded write with a raw Error (500) — reject up front (400).
  if (
    !isCancel &&
    !(ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status)
  ) {
    throw new BadRequestError(
      "This revision can no longer be scheduled — it was already published or discarded.",
    );
  }

  // Arming a future publish is blocked while locked; canceling a schedule is not.
  if (!isCancel) {
    assertConfigNotLocked(config);
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

  const adapter = getAdapter("config");
  const snapshot = config as Record<string, unknown>;

  // Canceling needs publish authority; arming additionally needs the
  // scheduled-publish capability (premium feature + that publish authority).
  const canPublish = adapter.canPublishRevision
    ? adapter.canPublishRevision(req.context, snapshot)
    : adapter.canUpdate(req.context, snapshot);
  const canSchedule = adapter.canSchedulePublish
    ? adapter.canSchedulePublish(req.context, snapshot)
    : req.context.hasPremiumFeature("scheduled-revisions") && canPublish;
  if (isCancel ? !canPublish : !canSchedule) {
    req.context.permissions.throwPermissionError();
  }

  const wantsBypass =
    !!bypassApproval && adapter.canBypassApproval(req.context, snapshot);

  const enabledBy =
    req.context.userId ||
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
      ? adapter.isApprovalRequiredForRevision(req.context, revision)
      : adapter.isApprovalRequired(req.context);
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
        req.context,
        config as unknown as Record<string, unknown>,
        revision.target.proposedChanges,
      );

  const updated = await req.context.models.revisions.setScheduledPublish(
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

  await dispatchConfigRevisionEvent(req.context, updated, { type: "updated" });

  return { revision: await toApiConfigRevision(updated, req.context) };
});
