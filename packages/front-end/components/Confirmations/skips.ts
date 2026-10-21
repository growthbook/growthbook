import {
  BYPASS_OVERRIDE_ACTIONS,
  type ConfirmAction,
  type ConfirmationNotice,
} from "shared/validators";

// Bypassed by the caller's authority or an org setting, not a flag it sent.
export const POLICY_VIAS = new Set<ConfirmationNotice["via"]>([
  "bypassApprovalPermission",
  "restApiBypassesReviews",
  "revertsBypassApproval",
]);

// A check the request skips: the override that skips it, if any, and what the
// check said, if it has run.
export type Skip = {
  action: ConfirmAction | null;
  notices: ConfirmationNotice[];
};

// Every notice lands in exactly one skip. Text from a refused attempt belongs to
// the flag the retry sent, when it sent just one.
export function skipsOf(
  overrides: ConfirmAction[],
  sentOverrides: ConfirmAction[],
  notices: ConfirmationNotice[],
): Skip[] {
  const ownerOf = (notice: ConfirmationNotice) =>
    notice.via ? BYPASS_OVERRIDE_ACTIONS[notice.via] : null;
  const skips: Skip[] = overrides.map((action) => ({
    action,
    notices: notices.filter((notice) => ownerOf(notice) === action),
  }));
  const loose = notices.filter((notice) => {
    const owner = ownerOf(notice);
    return !owner || !overrides.includes(owner);
  });
  const bareSent = skips.filter(
    (skip) =>
      !skip.notices.length &&
      skip.action !== null &&
      sentOverrides.includes(skip.action),
  );
  const refusals =
    bareSent.length === 1 ? loose.filter((notice) => notice.via === null) : [];
  if (refusals.length) bareSent[0].notices = refusals;
  return [
    ...skips,
    ...loose
      .filter((notice) => !refusals.includes(notice))
      .map((notice) => ({ action: null, notices: [notice] })),
  ];
}

export const isPolicySkip = (skip: Skip) =>
  skip.action === "override.restBypassesReviews" ||
  skip.notices.some((notice) => POLICY_VIAS.has(notice.via));

export const skipSeverity = (skip: Skip): ConfirmationNotice["severity"] =>
  skip.notices.some((notice) => notice.severity === "error")
    ? "error"
    : "warning";
