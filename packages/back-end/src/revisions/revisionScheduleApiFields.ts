import { Revision } from "shared/enterprise";

function serializeDate(
  date: Date | string | null | undefined,
): string | undefined {
  if ((date ?? null) === null) return undefined;
  return date instanceof Date ? date.toISOString() : String(date);
}

/** Serializes deferred-publish fields, omitting absent values across revision APIs. */
export function revisionScheduleApiFields(revision: Revision) {
  const scheduledPublishAt = serializeDate(revision.scheduledPublishAt);
  const scheduledPublishGaveUpAt = serializeDate(
    revision.scheduledPublishGaveUpAt,
  );

  return {
    ...(revision.autoPublishOnApproval ? { autoPublishOnApproval: true } : {}),
    ...(revision.autoPublishEnabledBy
      ? { autoPublishEnabledBy: revision.autoPublishEnabledBy }
      : {}),
    ...(scheduledPublishAt ? { scheduledPublishAt } : {}),
    ...(revision.scheduledPublishLockEdits
      ? { scheduledPublishLockEdits: true }
      : {}),
    ...(revision.scheduledPublishLockOthers
      ? { scheduledPublishLockOthers: true }
      : {}),
    ...(revision.scheduledPublishBypassApproval
      ? { scheduledPublishBypassApproval: true }
      : {}),
    ...(revision.scheduledPublishAttempts
      ? { scheduledPublishAttempts: revision.scheduledPublishAttempts }
      : {}),
    ...(revision.scheduledPublishLastError
      ? { scheduledPublishLastError: revision.scheduledPublishLastError }
      : {}),
    ...(scheduledPublishGaveUpAt ? { scheduledPublishGaveUpAt } : {}),
  };
}
