import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS } from "./entitlements";

// GrowthBook feature-flag key holding the OrgLimits stamped onto NEWLY
// CREATED free organizations. Read once at org creation (see back-end
// services/plan-limits.ts) — enforcement always reads the stored snapshot,
// never the flag, so editing the flag tunes future orgs without touching
// existing ones. Flag value shape (any field may be omitted):
//   { "maxProjects": 1, "customEnvironments": false, "roleManagement": false }
export const PRICING_PHASE_1_FLAG_KEY = "pricing-phase-1-limits";

const maxProjectsSchema = z.number().int().nonnegative().nullable();
const flagBoolSchema = z.boolean();

// Turn a raw flag value (possibly missing, partial, or partially invalid)
// into a COMPLETE OrgLimits stamp. Every field independently falls back to
// FREE_ORG_LIMITS, so a bad flag edit can never stamp an org with an
// undefined limit, while any valid field the flag does set is honored —
// letting the limits be tuned without respecifying the whole object.
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
