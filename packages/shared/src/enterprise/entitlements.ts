import { DEFAULT_ENVIRONMENT_IDS } from "../util";
import { getValidDate } from "../dates";
import {
  AccountPlan,
  CommercialFeature,
  OrgLimits,
  accountFeatures,
} from "./license-consts";

export const FREE_ORG_LIMITS: OrgLimits = {
  maxProjects: 1,
  customEnvironments: false,
  roleManagement: false,
};

export const PRO_ORG_LIMITS: OrgLimits = {
  maxProjects: 3,
  customEnvironments: false,
  roleManagement: true,
};

// Enterprise is absent on purpose — it is never subject to plan limits.
export type LimitedPlanTier = "free" | "pro";

export const DEFAULT_ORG_LIMITS: Record<LimitedPlanTier, OrgLimits> = {
  free: FREE_ORG_LIMITS,
  pro: PRO_ORG_LIMITS,
};

export function planTierFor(plan: AccountPlan): LimitedPlanTier | null {
  if (plan === "oss" || plan === "starter") return "free";
  if (plan === "pro" || plan === "pro_sso") return "pro";
  return null;
}

// Preserve pre-rollout Pro entitlements without changing Free limits.
export const PAID_PLAN_LIMITS_START_DATE = new Date("2026-09-12T00:00:00.000Z");

// Unknown signup dates keep grandfathered access.
function signedUpBeforePaidPlanLimits(
  dateCreated?: Date | string | null,
): boolean {
  return getValidDate(dateCreated, new Date(0)) < PAID_PLAN_LIMITS_START_DATE;
}

type LimitsInput = {
  effectivePlan: AccountPlan;
  // Stamped at org creation. Its absence means the org is grandfathered.
  orgLimits?: OrgLimits;
  licenseLimits?: OrgLimits;
  planLimits?: OrgLimits;
  orgDateCreated?: Date | string | null;
};

function planAllows(
  { effectivePlan }: LimitsInput,
  feature: CommercialFeature,
): boolean {
  return accountFeatures[effectivePlan].has(feature);
}

function resolve({
  effectivePlan,
  orgLimits,
  licenseLimits,
  planLimits,
  orgDateCreated,
}: LimitsInput): OrgLimits | null {
  if (effectivePlan === "oss" || effectivePlan === "starter") {
    return orgLimits ?? null;
  }

  if (licenseLimits) return licenseLimits;

  if (!orgLimits) return null;

  if (signedUpBeforePaidPlanLimits(orgDateCreated)) return null;

  const tier = planTierFor(effectivePlan);
  if (!tier) return null;

  // The stamp holds free values, so an upgraded org reads its new tier's.
  return planLimits ?? DEFAULT_ORG_LIMITS[tier];
}

function getMaxProjects(input: LimitsInput): number | null {
  if (planAllows(input, "unlimited-projects")) return null;
  return resolve(input)?.maxProjects ?? null;
}

function supportsCustomEnvironments(input: LimitsInput): boolean {
  if (planAllows(input, "custom-environments")) return true;
  const limits = resolve(input);
  if (!limits) return true;
  return limits.customEnvironments !== false;
}

function isEnvironmentIdAllowed(input: LimitsInput, envId: string): boolean {
  if (supportsCustomEnvironments(input)) return true;
  return DEFAULT_ENVIRONMENT_IDS.includes(envId);
}

function orgSupportsRoles(input: LimitsInput): boolean {
  if (planAllows(input, "role-management")) return true;
  const limits = resolve(input);
  if (!limits) return true;
  return limits.roleManagement !== false;
}

export function makeOrgLimits(input: LimitsInput) {
  return {
    getMaxProjects: () => getMaxProjects(input),
    isEnvironmentIdAllowed: (envId: string) =>
      isEnvironmentIdAllowed(input, envId),
    supportsCustomEnvironments: () => supportsCustomEnvironments(input),
    orgSupportsRoles: () => orgSupportsRoles(input),
  };
}

export type OrgLimitsAccessor = ReturnType<typeof makeOrgLimits>;
