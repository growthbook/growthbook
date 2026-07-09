// ── Scheduled / deferred publish ────────────────────────────────────────────
// Pure, entity-agnostic helpers shared by the UI, the lockdown gates, and the
// poller. A revision is "armed" (autoPublishOnApproval) when it should publish
// itself as soon as governance allows; `scheduledPublishAt` defers that to a
// target date. These were originally feature-specific (shared/util/features)
// and are re-exported from there for backward compatibility.

const SCHEDULE_PENDING_STATUSES = new Set<string>([
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
]);

// Structural shape any revision-like object satisfies — intentionally not tied
// to a specific entity type (features, saved groups, etc. all satisfy it).
export type ScheduledRevisionFields = {
  version?: number;
  status: string;
  autoPublishOnApproval?: boolean | null;
  scheduledPublishAt?: Date | string | null;
  scheduledPublishLockEdits?: boolean | null;
  scheduledPublishLockOthers?: boolean | null;
  scheduledPublishBypassApproval?: boolean | null;
};

// A schedule is "pending" when the revision is armed, has a date, and is still
// an active draft.
export function isScheduledPublishPending(
  revision: Pick<
    ScheduledRevisionFields,
    "status" | "autoPublishOnApproval" | "scheduledPublishAt"
  >,
): boolean {
  return (
    !!revision.autoPublishOnApproval &&
    (revision.scheduledPublishAt ?? null) !== null &&
    SCHEDULE_PENDING_STATUSES.has(revision.status)
  );
}

// True once a pending schedule's date has arrived. Coerces the date so it works
// on both Date (back-end) and ISO-string (front-end) shapes.
export function isScheduledPublishDue(
  revision: Pick<
    ScheduledRevisionFields,
    "status" | "autoPublishOnApproval" | "scheduledPublishAt"
  >,
  now: Date = new Date(),
): boolean {
  if (!isScheduledPublishPending(revision)) return false;
  const at = new Date(revision.scheduledPublishAt as Date | string);
  return at.getTime() <= now.getTime();
}

// Locks (and the publish) take effect once the schedule is committed and no
// longer awaiting approval: status "approved" (approval flow) or "draft"
// (no-approval flow). "pending-review"/"changes-requested" normally stay
// editable — EXCEPT an admin bypass-approval schedule, which fires regardless of
// approval, so its locks take effect immediately (even while still in review).
export function isScheduledPublishLockActive(
  revision: Pick<
    ScheduledRevisionFields,
    | "status"
    | "autoPublishOnApproval"
    | "scheduledPublishAt"
    | "scheduledPublishBypassApproval"
  >,
): boolean {
  if (!isScheduledPublishPending(revision)) return false;
  if (revision.scheduledPublishBypassApproval) return true;
  return (
    revision.status !== "pending-review" &&
    revision.status !== "changes-requested"
  );
}

// Content edits to this draft are frozen while a lock-edits schedule is active
// (armed AND approved). Pending-approval drafts remain editable.
export function isRevisionEditLockedBySchedule(
  revision: Pick<
    ScheduledRevisionFields,
    | "status"
    | "autoPublishOnApproval"
    | "scheduledPublishAt"
    | "scheduledPublishLockEdits"
  >,
): boolean {
  return (
    !!revision.scheduledPublishLockEdits &&
    isScheduledPublishLockActive(revision)
  );
}

// Among an entity's revisions, find one (other than `excludeVersion`) whose
// active (armed AND approved) schedule blocks publishing sibling drafts.
export function findPublishLockingScheduledRevision<
  T extends ScheduledRevisionFields,
>(revisions: T[], excludeVersion?: number): T | null {
  return (
    revisions.find(
      (r) =>
        r.version !== excludeVersion &&
        !!r.scheduledPublishLockOthers &&
        isScheduledPublishLockActive(r),
    ) ?? null
  );
}
