import { OAuthPermissionLimit } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { getRoleById, getRoles } from "shared/permissions";
import { ApiReqContext } from "back-end/types/api";
import {
  assertProjectRulesReferenceProjects,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { getEffectiveOrgLimits } from "back-end/src/services/plan-limits";

/** Roles a member can limit a token to on the consent screen; empty when the plan has no roles. */
export function getConsentRoleOptions(org: OrganizationInterface) {
  if (!getEffectiveOrgLimits(org).orgSupportsRoles()) return [];
  return getRoles(org)
    .filter((r) => r.id !== "noaccess" && !org.deactivatedRoles?.includes(r.id))
    .map((r) => ({
      id: r.id,
      name: r.displayName || r.id,
      description: r.description,
    }));
}

/** Same rules and plan gates as an org API key's role settings. */
export async function assertValidPermissionLimit(
  context: ApiReqContext,
  limit: OAuthPermissionLimit,
  previous: OAuthPermissionLimit = null,
): Promise<void> {
  if (!limit) return;

  const validateRole = (role: string) => {
    if (context.org.deactivatedRoles?.includes(role)) {
      context.throwBadRequestError(`Role has been deactivated: ${role}`);
    }
    if (!getRoleById(role, context.org)) {
      context.throwBadRequestError(`Invalid role: ${role}`);
    }
  };
  const orgEnvIds = getEnvironmentIdsFromOrg(context.org);
  const validateEnvironments = (environments: string[]) => {
    for (const env of environments) {
      if (!orgEnvIds.includes(env)) {
        context.throwBadRequestError(`Invalid environment: ${env}`);
      }
    }
  };

  validateRole(limit.role);
  // Only gate a change, so an existing limit stays editable after a downgrade.
  if (
    limit.role !== previous?.role &&
    limit.role !== "admin" &&
    !context.limits.orgSupportsRoles()
  ) {
    context.throwPaymentRequiredError(
      "Your plan only supports the admin role. Upgrade your plan to limit OAuth access by role.",
    );
  }
  if (
    (limit.limitAccessByEnvironment ||
      limit.additionalRoles?.some((r) => r.limitAccessByEnvironment)) &&
    !context.hasPremiumFeature("advanced-permissions")
  ) {
    context.throwPlanDoesNotAllowError(
      "Your plan does not support limiting OAuth access by environment.",
    );
  }
  validateEnvironments(limit.environments);
  for (const rule of limit.additionalRoles ?? []) {
    validateRole(rule.role);
    validateEnvironments(rule.environments);
  }

  if (!limit.projectRoles?.length) return;
  if (!context.hasPremiumFeature("advanced-permissions")) {
    context.throwPlanDoesNotAllowError(
      "Your plan does not support limiting OAuth access by project.",
    );
  }
  for (const pr of limit.projectRoles) {
    validateRole(pr.role);
    validateEnvironments(pr.environments);
    for (const rule of pr.additionalRoles ?? []) {
      validateRole(rule.role);
      validateEnvironments(rule.environments);
    }
  }
  try {
    await assertProjectRulesReferenceProjects(
      context,
      previous?.projectRoles,
      limit.projectRoles,
    );
  } catch (e) {
    context.throwBadRequestError(e.message);
  }
}
