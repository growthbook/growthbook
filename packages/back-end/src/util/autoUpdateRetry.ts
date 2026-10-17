const MINUTE = 60 * 1000;

// A failure past the end of this table turns auto-updates off.
const RETRY_DELAYS = [10 * MINUTE, 30 * MINUTE];

export type AutoUpdateFailureOutcome =
  | { action: "retry"; retryAt: Date }
  | { action: "disable" };

// `failures` counts consecutive failures including this one, so it starts at 1.
export function getAutoUpdateFailureOutcome(
  failures: number,
  now: Date,
): AutoUpdateFailureOutcome {
  if (failures > RETRY_DELAYS.length) return { action: "disable" };
  return {
    action: "retry",
    retryAt: new Date(now.getTime() + RETRY_DELAYS[failures - 1]),
  };
}
