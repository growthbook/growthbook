import { z } from "zod";
import { OrgLimits } from "./license-consts";
import { FREE_ORG_LIMITS } from "./entitlements";

// GrowthBook feature-flag key with two jobs. The value is keyed by plan tier
// so more tiers (e.g. "pro") can be added later without reshaping the flag.
// Any field may be omitted:
//   {
//     "enabled": true,
//     "free": { "maxProjects": 1, "customEnvironments": false,
//               "roleManagement": false }
//   }
//
// 1. STAMP (org creation, base value): the `free` tier is stamped onto newly
//    created organizations — see back-end services/plan-limits.ts. Editing it
//    tunes future orgs only; enforcement reads the stored stamp. (Paid-plan
//    limits are the license's job — `license.limits` — not the flag's, for
//    now: only `free` is wired up.)
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Turn a raw flag value (possibly missing, partial, or partially invalid)
// into the COMPLETE OrgLimits stamp for new orgs, read from the value's
// `free` tier. Every field independently falls back to FREE_ORG_LIMITS, so a
// bad flag edit can never stamp an org with an undefined limit, while any
// valid field the flag does set is honored — letting the limits be tuned
// without respecifying the whole object.
export function resolveOrgLimitsConfig(raw: unknown): OrgLimits {
  const free = asObject(asObject(raw).free);

  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };

  return {
    maxProjects: pick(
      maxProjectsSchema,
      free.maxProjects,
      FREE_ORG_LIMITS.maxProjects ?? null,
    ),
    customEnvironments: pick(
      flagBoolSchema,
      free.customEnvironments,
      FREE_ORG_LIMITS.customEnvironments ?? false,
    ),
    roleManagement: pick(
      flagBoolSchema,
      free.roleManagement,
      FREE_ORG_LIMITS.roleManagement ?? false,
    ),
  };
}
