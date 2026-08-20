import { putApprovalSettingsValidator } from "shared/validators";
import {
  ApprovalFlowConfigurations,
  OrganizationInterface,
  RequireReview,
} from "shared/types/organization";
import { normalizeApprovalRuleSettings } from "shared/util";
import { ApiReqContext } from "back-end/types/api";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";

// A rule naming something that does not exist gates nothing, so refuse it here
// rather than storing a requirement that silently never applies.
async function assertReferencesExist(
  context: ApiReqContext,
  rules: {
    projects?: string[];
    environments?: string[];
    requiredApproverTeams?: string[];
  }[],
) {
  const validProjects = new Set(await context.getAllProjectIds());
  const validEnvironments = new Set(
    (context.org.settings?.environments ?? []).map((e) => e.id),
  );
  const validTeams = new Set(
    (await context.models.teams.getAll()).map((t) => t.id),
  );

  rules.forEach((rule) => {
    (rule.projects ?? []).forEach((project) => {
      if (!validProjects.has(project)) {
        throw new Error(`${project} is not a valid project ID.`);
      }
    });
    (rule.environments ?? []).forEach((env) => {
      if (!validEnvironments.has(env)) {
        throw new Error(`${env} is not a valid environment ID.`);
      }
    });
    (rule.requiredApproverTeams ?? []).forEach((teamId) => {
      if (!validTeams.has(teamId)) {
        throw new Error(`${teamId} is not a valid team ID.`);
      }
    });
  });
}

export const putApprovalSettings = createApiRequestHandler(
  putApprovalSettingsValidator,
)(async (req) => {
  if (!req.context.permissions.canManageOrgSettings()) {
    req.context.permissions.throwPermissionError();
  }

  const org = req.context.org;
  const { requireReviews, approvalFlows } = req.body;

  // Matches the interactive route: saved-group approvals are the licensed part.
  if (
    approvalFlows?.savedGroups?.some((rule) => rule.required) &&
    !req.context.hasPremiumFeature("require-approvals")
  ) {
    throw new Error(
      "Saved Groups approval flows require the Require Approvals enterprise feature.",
    );
  }

  await assertReferencesExist(req.context, [
    ...(requireReviews ?? []),
    ...(approvalFlows?.savedGroups ?? []),
  ]);

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

  const updates: Partial<OrganizationInterface> = {
    settings: { ...org.settings, ...nextSettings },
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
        },
      },
      { settings: nextSettings },
    ),
  });

  const stored = updates.settings ?? {};
  return {
    requireReviews: (Array.isArray(stored.requireReviews)
      ? stored.requireReviews
      : []) as RequireReview[],
    approvalFlows: (stored.approvalFlows ?? {
      savedGroups: [],
    }) as ApprovalFlowConfigurations,
  };
});
