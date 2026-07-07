import { z } from "zod";
import { DEFAULT_ENVIRONMENT_IDS } from "../util";
import { AccountPlan } from "./license-consts";

// GrowthBook feature-flag key holding the Phase 1 pricing config, read via
// the back-end SDK. The SDK client is available on both cloud and
// self-hosted (as of #6299); DEFAULT_PRICING_LIMITS is the fail-open
// fallback for either — no client yet, init failed, no network, or the flag
// value fails schema validation — not a self-hosted-specific path.
export const PRICING_PHASE_1_FLAG_KEY = "pricing-phase-1-limits";

export const environmentPolicySchema = z.enum(["default-only", "all"]);
export type EnvironmentPolicy = z.infer<typeof environmentPolicySchema>;

export const rolePolicySchema = z.enum(["admin-only", "full"]);
export type RolePolicy = z.infer<typeof rolePolicySchema>;

export const pricingPhase1ConfigSchema = z.object({
  grandfatheringCutoffDate: z
    .string()
    .refine((v) => !isNaN(new Date(v).getTime()), {
      message: "grandfatheringCutoffDate must be a valid date string",
    }),
  projects: z.object({
    free: z.number().int().nonnegative(),
    pro: z.number().int().nonnegative(),
  }),
  environments: z.object({
    free: environmentPolicySchema,
    pro: environmentPolicySchema,
  }),
  // Pro/enterprise role management is unchanged, so only the free tier is configured.
  roles: z.object({
    free: rolePolicySchema,
  }),
});
export type PricingPhase1Config = z.infer<typeof pricingPhase1ConfigSchema>;

// In-app source of truth and the per-field fallback floor. Both cloud and
// self-hosted read the flag (see PRICING_PHASE_1_FLAG_KEY); any field the flag
// omits or supplies invalidly falls back to the value here, so callers always
// receive a complete, valid config.
export const DEFAULT_PRICING_LIMITS: PricingPhase1Config = {
  // The real launch cutoff lives in the pricing-phase-1-limits flag. This is
  // ONLY the fail-open fallback used when the flag can't be read: a far-future
  // sentinel grandfathers (exempts) every org, so a flag outage — or an
  // install that never reaches the flag — never wrongly starts enforcing
  // limits. Consequence: enforcement doesn't begin until a real (past/near)
  // cutoff is set in the flag. Do NOT hardcode the launch date here.
  grandfatheringCutoffDate: "9999-12-31",
  projects: { free: 1, pro: 3 },
  environments: { free: "default-only", pro: "default-only" },
  roles: { free: "admin-only" },
};

// Turn a raw flag value (possibly missing, partial, or partially invalid) into
// a COMPLETE, valid config. Every field independently falls back to
// DEFAULT_PRICING_LIMITS, so a caller can never end up with an undefined limit,
// while any valid field the flag does set is still honored — letting an
// operator tune one number without respecifying the whole config. Fail-open:
// an unreadable field falls back to the shipped default, never to a tighter
// value than we ship.
export function resolvePricingConfig(raw: unknown): PricingPhase1Config {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const proj = (obj.projects ?? {}) as Record<string, unknown>;
  const envs = (obj.environments ?? {}) as Record<string, unknown>;
  const roles = (obj.roles ?? {}) as Record<string, unknown>;
  const d = DEFAULT_PRICING_LIMITS;

  const cutoffSchema = z.string().refine((v) => !isNaN(new Date(v).getTime()));
  const countSchema = z.number().int().nonnegative();

  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };

  return {
    grandfatheringCutoffDate: pick(
      cutoffSchema,
      obj.grandfatheringCutoffDate,
      d.grandfatheringCutoffDate,
    ),
    projects: {
      free: pick(countSchema, proj.free, d.projects.free),
      pro: pick(countSchema, proj.pro, d.projects.pro),
    },
    environments: {
      free: pick(environmentPolicySchema, envs.free, d.environments.free),
      pro: pick(environmentPolicySchema, envs.pro, d.environments.pro),
    },
    roles: {
      free: pick(rolePolicySchema, roles.free, d.roles.free),
    },
  };
}

export type PlanLimits = {
  // null = unlimited (enterprise, grandfathered, or unknown plan)
  maxProjects: number | null;
  environmentPolicy: EnvironmentPolicy;
  rolePolicy: RolePolicy;
};

export const UNLIMITED_PLAN_LIMITS: PlanLimits = {
  maxProjects: null,
  environmentPolicy: "all",
  rolePolicy: "full",
};

export type PlanTier = "free" | "pro" | "exempt";

export function getPlanTier(plan: AccountPlan): PlanTier {
  if (plan === "enterprise") return "exempt";
  if (plan === "pro" || plan === "pro_sso") return "pro";
  if (plan === "oss" || plan === "starter") return "free";
  // Unknown/future plan → fail open so we never wrongly restrict.
  return "exempt";
}

// Orgs created strictly before the cutoff are grandfathered. A malformed cutoff
// fails open (treated as grandfathered) so a bad config never wrongly restricts.
export function isGrandfathered(
  orgDateCreated: Date,
  grandfatheringCutoffDate: string,
): boolean {
  const cutoff = new Date(grandfatheringCutoffDate);
  if (isNaN(cutoff.getTime())) return true;
  return orgDateCreated.getTime() < cutoff.getTime();
}

export function resolvePlanLimits({
  effectiveAccountPlan,
  orgDateCreated,
  config,
}: {
  effectiveAccountPlan: AccountPlan;
  orgDateCreated: Date;
  config: PricingPhase1Config;
}): PlanLimits {
  const tier = getPlanTier(effectiveAccountPlan);

  // Enterprise is exempt from all Phase 1 limits.
  if (tier === "exempt") return { ...UNLIMITED_PLAN_LIMITS };

  // Grandfathered orgs are fully exempt and can keep creating new resources.
  if (isGrandfathered(orgDateCreated, config.grandfatheringCutoffDate)) {
    return { ...UNLIMITED_PLAN_LIMITS };
  }

  if (tier === "free") {
    return {
      maxProjects: config.projects.free,
      environmentPolicy: config.environments.free,
      rolePolicy: config.roles.free,
    };
  }

  // pro / pro_sso: pro limits; role management unchanged.
  return {
    maxProjects: config.projects.pro,
    environmentPolicy: config.environments.pro,
    rolePolicy: "full",
  };
}

export function isEnvironmentIdAllowed(
  environmentId: string,
  policy: EnvironmentPolicy,
): boolean {
  if (policy === "all") return true;
  return (DEFAULT_ENVIRONMENT_IDS as readonly string[]).includes(environmentId);
}

export function isRoleAllowed(roleId: string, policy: RolePolicy): boolean {
  if (policy === "full") return true;
  return roleId === "admin";
}
