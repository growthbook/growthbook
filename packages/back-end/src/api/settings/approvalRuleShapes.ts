import {
  apiRequireReviewRule,
  apiSavedGroupApprovalRule,
} from "shared/validators";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";

// Orgs carry rule keys written by older versions. Returning only what the
// schema declares keeps a read something the write endpoint will accept back.
function pickDeclared<T extends object>(
  rule: T,
  shape: Record<string, unknown>,
): T {
  const source = rule as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(shape)
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  ) as T;
}

export const toApiRequireReviews = (rules: RequireReview[]) =>
  rules.map((rule) => pickDeclared(rule, apiRequireReviewRule.shape));

export const toApiSavedGroupApprovals = (rules: ApprovalFlowConfiguration[]) =>
  rules.map((rule) => pickDeclared(rule, apiSavedGroupApprovalRule.shape));
