import { Revision } from "shared/enterprise";

/** Serializes deferred-publish fields, omitting absent values across revision APIs. */
export function revisionScheduleApiFields(revision: Revision) {
  const date = (d: Date | string | null | undefined): string | undefined =>
    (d ?? null) === null
      ? undefined
      : d instanceof Date
        ? d.toISOString()
        : String(d);

  const scheduledPublishAt = date(revision.scheduledPublishAt);
  const scheduledPublishGaveUpAt = date(revision.scheduledPublishGaveUpAt);

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
