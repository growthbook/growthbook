import { postConfigRevisionSchedulePublishValidator } from "shared/validators";
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

  const updated = await req.context.models.revisions.setScheduledPublish(
    revision.id,
    enabledBy,
    {
      scheduledPublishAt: parsedDate,
      lockEdits,
      lockOthers,
      bypassApproval: wantsBypass,
    },
  );

  await dispatchConfigRevisionEvent(req.context, updated, { type: "updated" });

  return { revision: await toApiConfigRevision(updated, req.context) };
});
