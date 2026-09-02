import {
  FREE_ORG_LIMITS,
  OrgLimits,
  OrgLimitsAccessor,
  PRICING_PHASE_1_FLAG_KEY,
  isLimitsFlagDisabled,
  makeOrgLimits,
  resolveOrgLimitsConfig,
} from "shared/enterprise";
import { OrganizationInterface } from "shared/types/organization";
import { getEffectiveAccountPlan, getOrgLimits } from "back-end/src/enterprise";
import {
  getGrowthBookClient,
  getTrustedOrgAttributes,
  initializeGrowthBookClient,
} from "back-end/src/services/growthbook";
import { IS_CLOUD } from "back-end/src/util/secrets";

// Limits stamped onto a newly created org. Cloud reads the flag; self-hosted
// always uses the hardcoded defaults.
export async function getStampedOrgLimits(): Promise<OrgLimits> {
  if (!IS_CLOUD) return { ...FREE_ORG_LIMITS };

  // Bounded by the client's 3s init timeout — orgs created right after boot
  // still stamp from the configured flag instead of the hardcoded defaults.
  await initializeGrowthBookClient();
  const raw = getGrowthBookClient()?.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
    attributes: {},
  }).value;
  return resolveOrgLimitsConfig(raw);
}

function isPricingLimitsDisabledForOrg(org: OrganizationInterface): boolean {
  if (!IS_CLOUD) return false;

  const raw = getGrowthBookClient()?.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
    attributes: getTrustedOrgAttributes(org),
  }).value;
  return isLimitsFlagDisabled(raw);
}

// getOrgLimits, plus the flag's on/off switch: `enabled: false` (base value or
// a per-org targeting rule) lifts all limits for the evaluated org.
export function getEffectiveOrgLimits(
  org: OrganizationInterface,
): OrgLimitsAccessor {
  if (isPricingLimitsDisabledForOrg(org)) {
    return makeOrgLimits({ effectivePlan: getEffectiveAccountPlan(org) });
  }
  return getOrgLimits(org);
}
