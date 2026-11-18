import { z } from "zod";
import {
  apiApprovalFlowsInput,
  apiRequireReviewRule,
  apiSavedGroupApprovalRule,
  apiSdkConnectionApprovalRule,
} from "shared/validators";
import {
  ApprovalFlowConfiguration,
  ApprovalFlowConfigurations,
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

export const toApiSdkConnectionApprovals = (
  rules: ApprovalFlowConfiguration[],
) =>
  rules.map((rule) => pickDeclared(rule, apiSdkConnectionApprovalRule.shape));

// Each family the update supplies replaces the stored one; an omitted family
// keeps its stored rules.
export function mergeApprovalFlows(
  stored: ApprovalFlowConfigurations | undefined,
  update: z.infer<typeof apiApprovalFlowsInput>,
): ApprovalFlowConfigurations {
  const sdkConnections = update.sdkConnections ?? stored?.sdkConnections;
  return {
    ...stored,
    savedGroups: update.savedGroups ?? stored?.savedGroups ?? [],
    ...(sdkConnections ? { sdkConnections } : {}),
  };
}
