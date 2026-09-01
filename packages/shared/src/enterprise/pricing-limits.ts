import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS } from "./entitlements";

// Value shape: { "enabled": true, ...OrgLimits }. Per-plan values are served
// with targeting rules on the accountPlan attribute: the base value holds the
// free tier's limits (also used for the creation-time stamp), and a rule
// matching accountPlan in [pro, pro_sso] serves the pro tier's.
export const PRICING_PHASE_1_FLAG_KEY = "pricing-phase-1-limits";

export function isLimitsFlagDisabled(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).enabled === false
  );
}

const maxProjectsSchema = z.number().int().nonnegative().nullable();
const flagBoolSchema = z.boolean();

// Per-field fallback so the resolved config is always complete. Pass the tier's
// defaults as `fallback` when reading limits for a plan other than free.
export function resolveOrgLimitsConfig(
  raw: unknown,
  fallback: OrgLimits = FREE_ORG_LIMITS,
): OrgLimits {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const pick = <T>(
    schema: z.ZodType<T>,
    value: unknown,
    defaultValue: T,
  ): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : defaultValue;
  };

  return {
    maxProjects: pick(
      maxProjectsSchema,
      obj.maxProjects,
      fallback.maxProjects ?? null,
    ),
    customEnvironments: pick(
      flagBoolSchema,
      obj.customEnvironments,
      fallback.customEnvironments ?? false,
    ),
    roleManagement: pick(
      flagBoolSchema,
      obj.roleManagement,
      fallback.roleManagement ?? false,
    ),
  };
}
