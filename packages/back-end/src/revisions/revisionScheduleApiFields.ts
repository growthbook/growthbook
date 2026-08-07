import { Revision } from "shared/enterprise";

/**
 * A revision's deferred-publish state, shaped for any revision API response.
 *
 * One function for all three entities because the three serializers are otherwise
 * hand-written copies of each other, and a field added to one of them would have
 * stayed missing from the others — which is how none of them carried this state in
 * the first place. Callers spread the result.
 *
 * Every field is omitted rather than nulled when absent, matching how the rest of
 * these serializers treat optional data: an unarmed revision returns `{}`.
 */
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
