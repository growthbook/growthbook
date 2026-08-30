import type { FeatureRule } from "shared/types/feature";

/**
 * Rule id stem helpers — the single source of truth for the `__`-delimited
 * migration-suffix convention.
 *
 * Flattening from v1 (per-env rules) to v2 (a flat `feature.rules[]`) can
 * surface id collisions, since the same legacy `rule.id` can appear under
 * multiple envs with non-mergeable content. `flattenV1ToV2Rules` disambiguates
 * by appending `__<env>` (and, pathologically, `__<env>__<n>` for within-env
 * duplicates).
 *
 * Surface contract:
 *   - External (SDK payloads, tracking keys, telemetry, UI lookups) → stem.
 *   - Internal (storage, mutation targeting) → literal suffixed id.
 *
 * Invariant: `generateRuleId()` and user-supplied ids never contain `__`, so
 * any id containing `__` is a migration artifact and can be stemmed
 * unambiguously. This module is the ONLY place that should split on or
 * concatenate `__` onto a rule id — everything else must go through
 * `stemRuleId` / `suffixRuleId`.
 */

export const RULE_ID_ENV_SUFFIX_DELIMITER = "__";

// stemRuleId("fr_abc")             → "fr_abc"
// stemRuleId("fr_abc__production") → "fr_abc"
// stemRuleId("fr_abc__dev__2")     → "fr_abc"
export function stemRuleId(id: string): string {
  const i = id.indexOf(RULE_ID_ENV_SUFFIX_DELIMITER);
  return i === -1 ? id : id.slice(0, i);
}

// `stem` must be unsuffixed — stem it first if the caller can't guarantee.
// `occurrence` is for the pathological case where a legacy id appeared more
// than once within a single env's v1 rules.
//   suffixRuleId("fr_abc", "dev")    → "fr_abc__dev"
//   suffixRuleId("fr_abc", "dev", 2) → "fr_abc__dev__2"
export function suffixRuleId(
  stem: string,
  environment: string,
  occurrence?: number,
): string {
  const base = `${stem}${RULE_ID_ENV_SUFFIX_DELIMITER}${environment}`;
  if (occurrence === undefined || occurrence <= 1) return base;
  return `${base}${RULE_ID_ENV_SUFFIX_DELIMITER}${occurrence}`;
}

export function isMigrationSuffixedRuleId(id: string): boolean {
  return id.includes(RULE_ID_ENV_SUFFIX_DELIMITER);
}

export interface ParsedRuleId {
  stem: string;
  env?: string;
  occurrence?: number;
}

// Inverse of `suffixRuleId`. Prefer this over manual `.split("__")`.
//   parseRuleId("fr_abc")         → { stem: "fr_abc" }
//   parseRuleId("fr_abc__dev")    → { stem: "fr_abc", env: "dev" }
//   parseRuleId("fr_abc__dev__2") → { stem: "fr_abc", env: "dev", occurrence: 2 }
export function parseRuleId(id: string): ParsedRuleId {
  const parts = id.split(RULE_ID_ENV_SUFFIX_DELIMITER);
  if (parts.length === 1) return { stem: parts[0] };
  if (parts.length === 2) return { stem: parts[0], env: parts[1] };
  // 3+ segments: stem, env, occurrence. Extra segments (pathological, >3)
  // fold back into `env` for round-trip safety.
  const stem = parts[0];
  const occurrenceStr = parts[parts.length - 1];
  const occurrence = Number(occurrenceStr);
  if (Number.isInteger(occurrence) && occurrence >= 1) {
    const env = parts.slice(1, -1).join(RULE_ID_ENV_SUFFIX_DELIMITER);
    return { stem, env, occurrence };
  }
  return { stem, env: parts.slice(1).join(RULE_ID_ENV_SUFFIX_DELIMITER) };
}

export interface RampTargetQuery {
  ruleId?: string | null;
  environment?: string | null;
}

// Resolve a ramp target to every matching unified rule. Semantics by
// (ruleId shape, environment?):
//   (bare, env)      → match stem or stem__env, filtered by rule scope
//   (suffixed, env)  → stemmed; falls through to (bare, env)
//   (bare, no env)   → stem fan-out across all env siblings
//   (suffixed, no env) → exact id match
// `target.environment` is retained for pre-migration stored ramps.
export function resolveRampTargets(
  target: RampTargetQuery,
  unifiedRules: FeatureRule[],
): FeatureRule[] {
  if (!target.ruleId) return [];
  const stem = stemRuleId(target.ruleId);

  if (target.environment) {
    const env = target.environment;
    const suffixed = suffixRuleId(stem, env);
    return unifiedRules.filter((r) => {
      if (r.id !== stem && r.id !== suffixed) return false;
      if (r.allEnvironments) return true;
      return r.environments?.includes(env) ?? false;
    });
  }

  // No env supplied.
  if (isMigrationSuffixedRuleId(target.ruleId)) {
    // Caller explicitly disambiguated with a suffix — exact match only.
    const exact = target.ruleId;
    return unifiedRules.filter((r) => r.id === exact);
  }
  // Bare id, no env — stem fan-out.
  return unifiedRules.filter((r) => stemRuleId(r.id) === stem);
}

/**
 * The lookup key for a ramp target's current environments. Exported so the gate and
 * the loader cannot spell it differently — the environment is part of the identity
 * because `resolveRampTargets` resolves a different rule set with it than without.
 *
 * Components are ESCAPED, because a bare `:` join is ambiguous and that ambiguity is
 * the same last-write-wins collision the environment field was added to close, through
 * a different door. Feature ids permit `:` (`/^[a-zA-Z0-9_.:|-]+$/`) and rule ids are
 * an unconstrained string a client can supply, so `("a:b","c",…)` and `("a","b:c",…)`
 * both joined to `a:b:c:…` — letting a decoy target on a feature the caller DOES
 * control overwrite the answer for one it does not.
 */
export function rampRuleEnvKey(
  featureId: string,
  ruleId?: string,
  environment?: string,
): string {
  const parts = [featureId, ruleId ?? "", environment ?? ""];
  try {
    return parts.map(encodeURIComponent).join(":");
  } catch {
    // `encodeURIComponent` THROWS on a lone surrogate, and rule ids are an
    // unconstrained client-supplied string — so a crafted id turned the gate's key
    // computation into a 500 instead of a decision. Fail-closed either way, but a
    // total function is better than a crash.
    //
    // JSON handles lone surrogates (well-formed stringify escapes them) and is
    // injective, and its output starts with `[`, which `encodeURIComponent` always
    // escapes to `%5B` — so the fallback namespace cannot collide with the normal
    // one, and injectivity holds across both.
    return JSON.stringify(parts);
  }
}
