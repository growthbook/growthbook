import { DEFAULT_ENVIRONMENT_IDS } from "../util";
import { AccountPlan, OrgLimits } from "./license-consts";

export type OrgLimitsByPlan = {
  free: OrgLimits;
  // Reserved for later — paid-plan limits currently come from license.limits.
  pro?: OrgLimits;
};

// Hardcoded defaults, keyed by plan tier to mirror the pricing flag's shape.
export const DEFAULT_ORG_LIMITS: OrgLimitsByPlan = {
  free: {
    maxProjects: 1,
    customEnvironments: false,
    roleManagement: false,
  },
};

type LimitsInput = {
  effectivePlan: AccountPlan;
  orgLimits?: OrgLimits;
  licenseLimits?: OrgLimits;
};

// Free plans read the org's own snapshot; paid plans read the license's.
function resolve({
  effectivePlan,
  orgLimits,
  licenseLimits,
}: LimitsInput): OrgLimits | null {
  if (effectivePlan === "oss" || effectivePlan === "starter") {
    return orgLimits ?? null;
  }
  return licenseLimits ?? null;
}

function getMaxProjects(input: LimitsInput): number | null {
  return resolve(input)?.maxProjects ?? null;
}

function supportsCustomEnvironments(input: LimitsInput): boolean {
  const limits = resolve(input);
  if (!limits) return true;
  return limits.customEnvironments !== false;
}

function isEnvironmentIdAllowed(input: LimitsInput, envId: string): boolean {
  if (supportsCustomEnvironments(input)) return true;
  return DEFAULT_ENVIRONMENT_IDS.includes(envId);
}

function orgSupportsRoles(input: LimitsInput): boolean {
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
