import type { ApiRequestLocals } from "back-end/types/api";

export type ReviewBypassRequest = Pick<
  ApiRequestLocals,
  "context" | "isJwtAuth"
>;

export function canUseRestApiBypassSetting(req: ReviewBypassRequest): boolean {
  return !req.isJwtAuth && !!req.context.org.settings?.restApiBypassesReviews;
}

/** For a flag, or an experiment whose start publishes its flags' drafts. */
export function canBypassReviewChecks(
  req: ReviewBypassRequest,
  resource: { project?: string; projects?: string[] },
): boolean {
  return (
    canUseRestApiBypassSetting(req) ||
    req.context.permissions.canBypassFlagApprovalChecks(resource, "feature")
  );
}
