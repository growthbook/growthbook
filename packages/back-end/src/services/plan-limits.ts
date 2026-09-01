import {
  DEFAULT_ORG_LIMITS,
  FREE_ORG_LIMITS,
  OrgLimits,
  OrgLimitsAccessor,
  PRICING_PHASE_1_FLAG_KEY,
  isLimitsFlagDisabled,
  makeOrgLimits,
  planTierFor,
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
// always uses the hardcoded defaults. Every org is created free, so the stamp
// holds free values; its presence is what marks the org as non-grandfathered.
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

// Trusted server-derived attributes only — no request context, so the SDK's
// query-string override cannot influence enforcement.
function evalLimitsFlagForOrg(org: OrganizationInterface): unknown {
  if (!IS_CLOUD) return undefined;
  return getGrowthBookClient()?.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
    attributes: getTrustedOrgAttributes(org),
  }).value;
}

// getOrgLimits, plus the flag's on/off switch: `enabled: false` (base value or
// a per-org targeting rule) lifts all limits for the evaluated org. The served
// limit fields are the org's live per-plan config, which paid tiers need
// because their stamp is frozen at creation time on the free tier.
export function getEffectiveOrgLimits(
  org: OrganizationInterface,
): OrgLimitsAccessor {
  const effectivePlan = getEffectiveAccountPlan(org);
  const raw = evalLimitsFlagForOrg(org);

  if (isLimitsFlagDisabled(raw)) {
    return makeOrgLimits({ effectivePlan });
  }

  // Free limits come from the stamp, so only paid tiers read the flag here.
  const tier = planTierFor(effectivePlan);
  const planLimitsOverride =
    IS_CLOUD && tier && tier !== "free"
      ? resolveOrgLimitsConfig(raw, DEFAULT_ORG_LIMITS[tier])
      : undefined;

  return getOrgLimits(org, planLimitsOverride);
}
