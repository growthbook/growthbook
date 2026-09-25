import type { FeatureInterface } from "shared/types/feature";
import type { ApiRequestLocals } from "back-end/types/api";

export type ReviewBypassRequest = Pick<
  ApiRequestLocals,
  "context" | "isJwtAuth"
>;

export function canUseRestApiBypassSetting(req: ReviewBypassRequest): boolean {
  return !req.isJwtAuth && !!req.context.org.settings?.restApiBypassesReviews;
}

export function canBypassReviewChecks(
  req: ReviewBypassRequest,
  feature: FeatureInterface,
): boolean {
  return (
    canUseRestApiBypassSetting(req) ||
    req.context.permissions.canBypassFlagApprovalChecks(feature, "feature")
  );
}
