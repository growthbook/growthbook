import {
  DEFAULT_ORG_LIMITS,
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

// Limits stamped onto every newly created org. The stamp records that the org
// was created in the limits era; whether limits are enforced is decided at read
// time by the flag's kill switch (getEffectiveOrgLimits), never here — an
// unstamped org is permanently unlimited. An unreachable flag falls back to
// the hardcoded defaults.
export async function getStampedOrgLimits(): Promise<OrgLimits> {
  // Bounded by the client's 3s init timeout so startup can use configured values.
  await initializeGrowthBookClient();
  const raw = getGrowthBookClient()?.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
    // A new org is always on the free tier; this lets the flag's accountPlan
    // and orgDateCreated targeting rules fire at stamp time.
    attributes: {
      accountPlan: IS_CLOUD ? "starter" : "oss",
      orgDateCreated: new Date().toISOString(),
    },
  }).value;

  return resolveOrgLimitsConfig(raw);
}

function evalLimitsFlagForOrg(org: OrganizationInterface): unknown {
  return getGrowthBookClient()?.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
    attributes: getTrustedOrgAttributes(org),
  }).value;
}

// getOrgLimits, plus the flag's on/off switch: `enabled: false` (base value or
// a per-org targeting rule) lifts all limits for the evaluated org.
export function getEffectiveOrgLimits(
  org: OrganizationInterface,
): OrgLimitsAccessor {
  const effectivePlan = getEffectiveAccountPlan(org);
  const raw = evalLimitsFlagForOrg(org);

  if (isLimitsFlagDisabled(raw)) {
    return makeOrgLimits({ effectivePlan });
  }

  const tier = planTierFor(effectivePlan);
  const planLimitsOverride =
    tier && tier !== "free"
      ? resolveOrgLimitsConfig(raw, DEFAULT_ORG_LIMITS[tier])
      : undefined;

  return getOrgLimits(org, planLimitsOverride);
}
