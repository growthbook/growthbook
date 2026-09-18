import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS } from "./entitlements";

// Value shape: { "enabled": true, ...OrgLimits }. Per-plan values are served
// with targeting rules on the accountPlan attribute.
export const PRICING_PHASE_1_FLAG_KEY = "pricing-phase-1-limits";

// The one definition of "the flag served a usable config".
function asLimitsConfig(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function isLimitsFlagDisabled(raw: unknown): boolean {
  return asLimitsConfig(raw)?.enabled === false;
}

const maxProjectsSchema = z.number().int().nonnegative().nullable();
const flagBoolSchema = z.boolean();

// Per-field fallback to the tier's defaults so the config is always complete.
export function resolveOrgLimitsConfig(
  raw: unknown,
  defaults: OrgLimits = FREE_ORG_LIMITS,
): OrgLimits {
  const obj = asLimitsConfig(raw) ?? {};

  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };

  return {
    maxProjects: pick(
      maxProjectsSchema,
      obj.maxProjects,
      defaults.maxProjects ?? null,
    ),
    customEnvironments: pick(
      flagBoolSchema,
      obj.customEnvironments,
      defaults.customEnvironments ?? false,
    ),
    roleManagement: pick(
      flagBoolSchema,
      obj.roleManagement,
      defaults.roleManagement ?? false,
    ),
  };
}
