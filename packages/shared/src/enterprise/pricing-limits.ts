import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { DEFAULT_ORG_LIMITS } from "./entitlements";

// Value shape: { "enabled": true, "free": { ...OrgLimits } }
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Per-field fallback to DEFAULT_ORG_LIMITS.free so the stamp is always complete.
export function resolveOrgLimitsConfig(raw: unknown): OrgLimits {
  const free = asObject(asObject(raw).free);
  const defaults = DEFAULT_ORG_LIMITS.free;

  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };

  return {
    maxProjects: pick(
      maxProjectsSchema,
      free.maxProjects,
      defaults.maxProjects ?? null,
    ),
    customEnvironments: pick(
      flagBoolSchema,
      free.customEnvironments,
      defaults.customEnvironments ?? false,
    ),
    roleManagement: pick(
      flagBoolSchema,
      free.roleManagement,
      defaults.roleManagement ?? false,
    ),
  };
}
