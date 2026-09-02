import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS } from "./entitlements";

// Value shape: { "enabled": true, ...OrgLimits, allowLegacyProCheckout?: boolean }.
// Per-plan values can be served later with targeting rules on accountPlan.
export const PRICING_PHASE_1_FLAG_KEY = "pricing-phase-1-limits";

export function isLimitsFlagDisabled(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).enabled === false
  );
}

// Live checkout key (not stamped). Explicit false hides the seat-based option;
// anything else keeps the dual-offer on.
export function isLegacyProCheckoutAllowed(raw: unknown): boolean {
  return !(
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).allowLegacyProCheckout === false
  );
}

// Read the org stamp, not the live flag. Kill-switch lifting of entitlements
// must not change which Pro SKU the upgrade modal defaults to.
export function orgDefaultsToSeatlessPro(
  orgLimits?: OrgLimits | null,
): boolean {
  return orgLimits?.dataSources != null;
}

const maxProjectsSchema = z.number().int().nonnegative().nullable();
const flagBoolSchema = z.boolean();
const dataSourceLimitSchema = z.enum([
  "managed-only",
  "one-byow-plus-forwarder",
]);

// Per-field fallback to FREE_ORG_LIMITS so the stamp is always complete —
// except dataSources, which is omitted unless the flag explicitly sets it.
// Falling back would put every new org in the seatless-Pro cohort.
export function resolveOrgLimitsConfig(raw: unknown): OrgLimits {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };

  const dataSources = dataSourceLimitSchema.safeParse(obj.dataSources);

  return {
    maxProjects: pick(
      maxProjectsSchema,
      obj.maxProjects,
      FREE_ORG_LIMITS.maxProjects ?? null,
    ),
    customEnvironments: pick(
      flagBoolSchema,
      obj.customEnvironments,
      FREE_ORG_LIMITS.customEnvironments ?? false,
    ),
    roleManagement: pick(
      flagBoolSchema,
      obj.roleManagement,
      FREE_ORG_LIMITS.roleManagement ?? false,
    ),
    ...(dataSources.success ? { dataSources: dataSources.data } : {}),
  };
}
