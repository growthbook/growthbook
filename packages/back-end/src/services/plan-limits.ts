import crypto from "crypto";
import {
  DEFAULT_PRICING_LIMITS,
  PRICING_PHASE_1_FLAG_KEY,
  PlanLimits,
  PricingPhase1Config,
  isEnvironmentIdAllowed,
  isRoleAllowed,
  resolvePlanLimits,
  resolvePricingConfig,
} from "shared/enterprise";
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { DEFAULT_ENVIRONMENT_IDS } from "shared/util";
import { OrganizationInterface } from "shared/types/organization";
import { getEffectiveAccountPlan } from "back-end/src/enterprise/licenseUtil";
import { getGrowthBookClient } from "back-end/src/services/growthbook";
import { PlanLimitError } from "back-end/src/util/errors";
import { IS_CLOUD } from "back-end/src/util/secrets";

/**
 * Org-level targeting attributes derived exclusively from trusted server-side
 * data. Names and hashing mirror the front-end (services/UserContext.tsx) so
 * one flag config can target both apps consistently. Per-user and per-request
 * attributes (role, session ids, url) are deliberately absent — enforcement
 * flags are org-scoped, and an eval context carrying a `url` would honor
 * query-string variation overrides (see the back-end SDK security audit).
 */
export function getTrustedOrgAttributes(
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
    // ?? rather than the FE's || — an explicit freeSeats of 0 must not read as 3
    freeSeats: org.freeSeats ?? 3,
    discountCode: org.discountCode || "",
    isVercelIntegration: !!org.isVercelIntegration,
  };
}

/**
 * Pricing Phase 1 config: numbers come from the `pricing-phase-1-limits`
 * flag (so limits can be tuned without a deploy), schema-validated with the
 * in-app const as fallback. The GB client is available on both cloud and
 * self-hosted (#6299 removed the old cloud-only gate on getGrowthBookClient),
 * so this needs no environment check of its own — the fallback triggers
 * uniformly on no client / not-yet-initialized / no network / invalid value.
 * Fail-open by construction: a bad/missing config can loosen limits, never
 * wrongly tighten them.
 *
 * SECURITY: evaluated against trusted server-derived org attributes only —
 * never request-supplied context. The flag supplies config *numbers*; the
 * limit *decision* (plan tier, grandfathering) stays in resolvePlanLimits.
 */
export function getPricingConfig(
  org: OrganizationInterface,
): PricingPhase1Config {
  const client = getGrowthBookClient();
  if (!client) return DEFAULT_PRICING_LIMITS;

  // Read the raw flag value defensively: any SDK error (not just a missing
  // flag, which returns null) leaves raw null so resolvePricingConfig returns
  // the full const. resolvePricingConfig then fills every missing/invalid
  // field from the const, so the result is always a complete, valid config.
  let raw: unknown = null;
  try {
    raw = client.evalFeature(PRICING_PHASE_1_FLAG_KEY, {
      attributes: getTrustedOrgAttributes(org),
    }).value;
  } catch {
    raw = null;
  }
  return resolvePricingConfig(raw);
}

/**
 * Resolved Phase 1 limits for an org. `maxProjects: null` = unlimited.
 * Callers enforce softly: block creating *new* resources only.
 */
export function getPlanLimits(org: OrganizationInterface): PlanLimits {
  return resolvePlanLimits({
    effectiveAccountPlan: getEffectiveAccountPlan(org),
    // A missing dateCreated fails open: epoch predates any cutoff, so the
    // org resolves as grandfathered (exempt) rather than wrongly limited.
    orgDateCreated: org.dateCreated ?? new Date(0),
    config: getPricingConfig(org),
  });
}

/**
 * Soft plan limit on environments: under the default-only policy, only ids in
 * DEFAULT_ENVIRONMENT_IDS may be *created*. Editing or keeping existing
 * environments — including custom ones — is never blocked.
 */
export function assertEnvironmentCreateAllowed(
  org: OrganizationInterface,
  environmentId: string,
): void {
  const { environmentPolicy } = getPlanLimits(org);
  if (!isEnvironmentIdAllowed(environmentId, environmentPolicy)) {
    throw new PlanLimitError(
      `Your plan only allows the default environments (${DEFAULT_ENVIRONMENT_IDS.join(
        ", ",
      )}). Upgrade to create custom environments.`,
      { limit: "environments" },
    );
  }
}

/**
 * Soft plan limit on roles: under the admin-only policy, only the admin role
 * may be *assigned* (global role, project role, invite, or team default).
 * Members who already hold a non-admin role keep it — this only blocks new
 * assignments, so getRoles(org)/isRoleValid validity is unaffected.
 */
export function assertRoleAssignmentAllowed(
  org: OrganizationInterface,
  role: string,
): void {
  const { rolePolicy } = getPlanLimits(org);
  if (!isRoleAllowed(role, rolePolicy)) {
    throw new PlanLimitError(
      "Your plan only allows the admin role. Upgrade to assign other roles.",
      { limit: "roles" },
    );
  }
}
