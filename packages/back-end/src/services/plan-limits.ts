import {
  FREE_ORG_LIMITS,
  OrgLimits,
  PRICING_PHASE_1_FLAG_KEY,
  resolveOrgLimitsConfig,
} from "shared/enterprise";
import { getGrowthBookClient } from "back-end/src/services/growthbook";

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
    raw = client.evalFeature(PRICING_PHASE_1_FLAG_KEY, { attributes: {} })
      .value;
  } catch {
    raw = null;
  }
  return resolveOrgLimitsConfig(raw);
}
