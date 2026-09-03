import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS } from "./entitlements";

// Value shape: { "enabled": true, ...OrgLimits }. Per-plan values can be
// served later with targeting rules on the accountPlan attribute.
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

// Per-field fallback to FREE_ORG_LIMITS so the stamp is always complete.
export function resolveOrgLimitsConfig(raw: unknown): OrgLimits {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };

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
  };
}
