import { pendingScheduleWarning } from "shared/util";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { SoftWarningError } from "back-end/src/util/errors";

type ScheduledRevision = Parameters<typeof pendingScheduleWarning>[0];

// Dashboard form: a 422 the panel's "Save anyway?" retry acknowledges.
export function assertPendingScheduleAcknowledged(
  context: { ignoreWarnings: boolean },
  revision: ScheduledRevision,
): void {
  const warning = pendingScheduleWarning(revision);
  if (warning && !context.ignoreWarnings) {
    throw new SoftWarningError(warning, [warning]);
  }
}

// REST form: one more acknowledge-class gate in the aggregated 422.
export function pendingScheduleGate(
  revision: ScheduledRevision,
): PublishGate | null {
  const warning = pendingScheduleWarning(revision);
  if (!warning) return null;
  return {
    type: "scheduled-publish-pending",
    severity: "warning",
    messages: [warning],
    override: "ignoreWarnings",
    requiresPermission: null,
    resolution: null,
  };
}
