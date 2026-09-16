import { putApprovalSettingsValidator } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import {
  assertTargetingRulesDisjoint,
  normalizeApprovalRuleSettings,
} from "shared/util";
import { assertApprovalRuleReferencesExist } from "back-end/src/services/approvalRuleReferences";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  toApiRequireReviews,
  toApiSavedGroupApprovals,
} from "./approvalRuleShapes";

export const putApprovalSettings = createApiRequestHandler(
  putApprovalSettingsValidator,
)(async (req) => {
  if (!req.context.permissions.canManageOrgSettings()) {
    req.context.permissions.throwPermissionError();
  }

  const org = req.context.org;
  const { requireReviews, approvalFlows, targetingReviewMode } = req.body;

  // Matches the interactive route: saved-group approvals are the licensed part.
  if (
    approvalFlows?.savedGroups?.some((rule) => rule.required) &&
    !req.context.hasPremiumFeature("require-approvals")
  ) {
    throw new Error(
      "Saved Groups approval flows require the Require Approvals enterprise feature.",
    );
  }

  await assertApprovalRuleReferencesExist(req.context, [
    ...(requireReviews ?? []),
    ...(approvalFlows?.savedGroups ?? []),
    ...(targetingReviewMode ?? []),
  ]);
  assertTargetingRulesDisjoint(targetingReviewMode ?? []);

  // An absent selector means the all-projects rule; storage spells that as [].
  const nextSettings = normalizeApprovalRuleSettings({
    ...(requireReviews
      ? {
          requireReviews: requireReviews.map((rule) => ({
            ...rule,
            projects: rule.projects ?? [],
          })),
        }
      : {}),
    ...(approvalFlows ? { approvalFlows } : {}),
  });
  const targetingUpdate = targetingReviewMode ? { targetingReviewMode } : {};

  const updates: Partial<OrganizationInterface> = {
    settings: { ...org.settings, ...nextSettings, ...targetingUpdate },
  };

  await updateOrganization(org.id, updates);

  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: org.id },
    details: auditDetailsUpdate(
      {
        settings: {
          requireReviews: org.settings?.requireReviews,
          approvalFlows: org.settings?.approvalFlows,
          targetingReviewMode: org.settings?.targetingReviewMode,
        },
      },
      { settings: { ...nextSettings, ...targetingUpdate } },
    ),
  });

  const stored = updates.settings ?? {};
  return {
    requireReviews: Array.isArray(stored.requireReviews)
      ? toApiRequireReviews(stored.requireReviews)
      : [],
    approvalFlows: {
      savedGroups: toApiSavedGroupApprovals(
        stored.approvalFlows?.savedGroups ?? [],
      ),
    },
    targetingReviewMode: stored.targetingReviewMode ?? [],
  };
});
