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
