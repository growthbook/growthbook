import crypto from "crypto";
import {
  FREE_ORG_LIMITS,
  OrgLimits,
  OrgLimitsAccessor,
  PRICING_PHASE_1_FLAG_KEY,
  isLimitsFlagDisabled,
  makeOrgLimits,
  resolveOrgLimitsConfig,
} from "shared/enterprise";
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { OrganizationInterface } from "shared/types/organization";
import { getEffectiveAccountPlan, getOrgLimits } from "back-end/src/enterprise";
import { getGrowthBookClient } from "back-end/src/services/growthbook";
import { IS_CLOUD } from "back-end/src/util/secrets";

/**
 * OrgLimits to stamp onto a newly created free organization. Values come from
 * the `pricing-phase-1-limits` flag so they can be tuned without a deploy;
 * FREE_ORG_LIMITS is the per-field fail-safe for a missing/partial/invalid
 * flag value or an unavailable client. Enforcement never reads the flag —
 * only this stamped snapshot — so editing the flag affects future orgs only.
 *
 * SECURITY: evaluated with EMPTY attributes (the org doesn't exist yet and
 * the flag is untargeted) and no request context, so the SDK's query-string
 * variation override can never influence the stamp.
 */
export function getStampedOrgLimits(): OrgLimits {
  const client = getGrowthBookClient();
  if (!client) return { ...FREE_ORG_LIMITS };

  let raw: unknown = null;
  try {
    raw = client.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
      attributes: {},
    }).value;
  } catch {
    raw = null;
  }
  return resolveOrgLimitsConfig(raw);
}

/**
 * Org-level targeting attributes derived exclusively from trusted server-side
 * data, mirroring the front-end's names (services/UserContext.tsx) so one
 * flag targeting rule matches both apps. Per-user and per-request attributes
 * (role, session ids, url) are deliberately absent — an eval context carrying
 * a `url` would honor query-string variation overrides (see the back-end SDK
 * security audit).
 */
function getTrustedOrgAttributes(
  org: OrganizationInterface,
): Record<string, unknown> {
  return {
    organizationId: crypto
      .createHash("sha256")
      .update(GROWTHBOOK_SECURE_ATTRIBUTE_SALT + org.id)
      .digest("hex"),
    cloudOrgId: IS_CLOUD ? org.id : "",
    orgDateCreated: org.dateCreated ? org.dateCreated.toISOString() : "",
    accountPlan: getEffectiveAccountPlan(org),
    hasLicenseKey: !!org.licenseKey,
  };
}

// Enforcement-time on/off: true only when the flag, evaluated for this org
// with trusted attributes, explicitly says enabled: false. Fail-closed toward
// the stamp: an unreachable/invalid flag keeps the stored limits in force.
function isPricingLimitsDisabledForOrg(org: OrganizationInterface): boolean {
  const client = getGrowthBookClient();
  if (!client) return false;

  try {
    const raw = client.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
      attributes: getTrustedOrgAttributes(org),
    }).value;
    return isLimitsFlagDisabled(raw);
  } catch {
    return false;
  }
}

/**
 * The org's limits accessor with the flag's on/off switch applied: a global
 * base value of `enabled: false`, or a targeting rule serving it for this
 * org, makes the org unlimited (support can exempt a customer with no
 * deploy). Otherwise identical to getOrgLimits (the stored snapshot).
 */
export function getEffectiveOrgLimits(
  org: OrganizationInterface,
): OrgLimitsAccessor {
  if (isPricingLimitsDisabledForOrg(org)) {
    // No stored/license limits passed ⇒ the accessor resolves to unlimited
    return makeOrgLimits({ effectivePlan: getEffectiveAccountPlan(org) });
  }
  return getOrgLimits(org);
}
