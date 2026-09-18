import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS, PAID_PLAN_LIMITS_START_DATE } from "./entitlements";

// Value shape: { "enabled": true, ...OrgLimits }. Per-plan values are served
// with targeting rules on the accountPlan attribute.
export const PRICING_PHASE_1_FLAG_KEY = "pricing-phase-1-limits";

export function isLimitsFlagDisabled(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).enabled === false
  );
}

// Only eligible signup dates can use flag values or fallback defaults.
export function shouldStampOrgLimits(
  org: { dateCreated: Date | string },
  raw: unknown,
): boolean {
  const dateCreated = new Date(org.dateCreated);
  if (
    isNaN(dateCreated.getTime()) ||
    dateCreated < PAID_PLAN_LIMITS_START_DATE
  ) {
    return false;
  }
  if ((raw ?? null) === null) return true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return !isLimitsFlagDisabled(raw);
}

const maxProjectsSchema = z.number().int().nonnegative().nullable();
const flagBoolSchema = z.boolean();

// Per-field fallback to the tier's defaults so the config is always complete.
export function resolveOrgLimitsConfig(
  raw: unknown,
  defaults: OrgLimits = FREE_ORG_LIMITS,
): OrgLimits {
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
