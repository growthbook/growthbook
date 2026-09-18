import {
  DEFAULT_ORG_LIMITS,
  OrgLimits,
  OrgLimitsAccessor,
  PRICING_PHASE_1_FLAG_KEY,
  isLimitsFlagDisabled,
  makeOrgLimits,
  planTierFor,
  resolveOrgLimitsConfig,
  shouldStampOrgLimits,
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
export async function getStampedOrgLimits(
  org: Pick<OrganizationInterface, "dateCreated">,
): Promise<OrgLimits | undefined> {
  let raw: unknown = null;
  if (IS_CLOUD) {
    // Bounded by the client's 3s init timeout so startup can use configured values.
    await initializeGrowthBookClient();
    raw = getGrowthBookClient()?.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
      attributes: {},
    }).value;
  }

  if (!shouldStampOrgLimits(org, raw)) return undefined;

  return resolveOrgLimitsConfig(raw);
}

function evalLimitsFlagForOrg(org: OrganizationInterface): unknown {
  if (!IS_CLOUD) return undefined;
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
    IS_CLOUD && tier && tier !== "free"
      ? resolveOrgLimitsConfig(raw, DEFAULT_ORG_LIMITS[tier])
      : undefined;

  return getOrgLimits(org, planLimitsOverride);
}
