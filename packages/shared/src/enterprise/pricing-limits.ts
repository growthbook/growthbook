import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS } from "./entitlements";

// GrowthBook feature-flag key with two jobs. Flag value shape (any field may
// be omitted):
//   { "enabled": true, "maxProjects": 1, "customEnvironments": false,
//     "roleManagement": false }
//
// 1. STAMP (org creation, base value): the limit fields are stamped onto
//    newly created free organizations — see back-end services/plan-limits.ts.
//    Editing them tunes future orgs only; enforcement reads the stored stamp.
// 2. ON/OFF (enforcement time, per-org targeting): when the value evaluated
//    for an org has `enabled: false`, that org's stored limits are ignored
//    entirely. Base value `enabled: false` = global kill switch; a targeting
//    rule serving {"enabled": false} = per-customer exemption. Both apply
//    instantly, no deploy.
export const PRICING_PHASE_1_FLAG_KEY = "pricing-phase-1-limits";

// Only an explicit `enabled: false` disables enforcement for the evaluated
// org. Anything else — missing flag, missing field, garbage — means enabled,
// so an unreachable flag falls back to the stamped snapshot (which is itself
// the safe default), never to a silently-widened exemption.
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
