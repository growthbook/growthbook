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
// always uses the hardcoded defaults. New orgs always start on the free tier,
// so the stamp holds free values — its presence is also what marks the org as
// subject to plan limits at all (missing = grandfathered, on every plan).
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

// The flag evaluated for this org, with trusted server-derived attributes only
// (no request context, so the SDK's query-string override cannot influence
// enforcement). Self-hosted never reads the CDN for limits.
function evalLimitsFlagForOrg(org: OrganizationInterface): unknown {
  if (!IS_CLOUD) return undefined;
  return getGrowthBookClient()?.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
    attributes: getTrustedOrgAttributes(org),
  }).value;
}

// getOrgLimits, plus the two enforcement-time jobs of the pricing flag:
//   - `enabled: false` (base value or a per-org targeting rule) lifts all
//     limits for the evaluated org.
//   - the served limit fields are the org's live per-plan config. Paid tiers
//     need this because the stamp is frozen at creation time (always free), so
//     an org that upgraded to Pro resolves its limits against its current plan
//     via an accountPlan targeting rule.
export function getEffectiveOrgLimits(
  org: OrganizationInterface,
): OrgLimitsAccessor {
  const raw = evalLimitsFlagForOrg(org);

  if (isLimitsFlagDisabled(raw)) {
    return makeOrgLimits({ effectivePlan: getEffectiveAccountPlan(org) });
  }

  // Free limits come from the stamp, not the flag, so only paid tiers need an
  // override here. Self-hosted falls through to getOrgLimits' tier defaults.
  const tier = planTierFor(getEffectiveAccountPlan(org));
  const planLimitsOverride =
    IS_CLOUD && tier && tier !== "free"
      ? resolveOrgLimitsConfig(raw, DEFAULT_ORG_LIMITS[tier])
      : undefined;

  return getOrgLimits(org, planLimitsOverride);
}
