/**
 * Rule id stem helpers — single source of truth for the `__`-delimited
 * migration-suffix convention.
 *
 * Background
 * ----------
 * During the v1 → v2 rule unification, some legacy features contain the same
 * `rule.id` across multiple environments with non-mergeable content (different
 * conditions, variations, etc.). Because the v2 on-disk shape is a flat
 * `feature.rules: FeatureRule[]`, having two rules with the same `id` in the
 * same feature creates ambiguity.
 *
 * To disambiguate, the flatten step (`flattenV1ToV2Rules`) renames the
 * non-mergeable occurrences by appending `__<env>` to the legacy id. Example:
 *
 *    legacy v1 (id collision):
 *       dev.rules        = [{ id: "fr_abc", condition: "A" }]
 *       production.rules = [{ id: "fr_abc", condition: "B" }]
 *
 *    v2 (flattened):
 *       rules = [
 *         { id: "fr_abc__dev",        environments: ["dev"],        ... },
 *         { id: "fr_abc__production", environments: ["production"], ... },
 *       ]
 *
 * The suffix is an INTERNAL implementation detail. External surfaces (SDK
 * payloads, tracking keys, telemetry queries, UI → rule lookups) always see
 * the stem (`fr_abc`). Internal surfaces (storage, mutation targeting) see
 * the literal suffixed id.
 *
 * Invariant
 * ---------
 * No `generateRuleId()` output or user-supplied id may contain `__`. This
 * guarantees that any id containing `__` is a migration artifact and can be
 * stem-stripped unambiguously. `generateRuleId` emits ids of the form
 * `fr_<uniqid>` where the uniqid block is alphanumeric, so the invariant
 * holds by construction. (A lock test enforces this.)
 *
 * Usage rule
 * ----------
 * This module is the ONLY place that should `.split("__")` or concatenate
 * `"__"` onto a rule id. Every other call site must go through `stemRuleId` /
 * `suffixRuleId`. Violations make the marker convention harder to change.
 */

export const RULE_ID_ENV_SUFFIX_DELIMITER = "__";

/**
 * Extract the logical (public) rule id by stripping any migration-added
 * environment suffix. Idempotent: `stemRuleId(stemRuleId(x)) === stemRuleId(x)`.
 *
 *   stemRuleId("fr_abc")                 → "fr_abc"
 *   stemRuleId("fr_abc__production")     → "fr_abc"
 *   stemRuleId("fr_abc__dev__2")         → "fr_abc"   // in-env duplicate
 */
export function stemRuleId(id: string): string {
  const i = id.indexOf(RULE_ID_ENV_SUFFIX_DELIMITER);
  return i === -1 ? id : id.slice(0, i);
}

/**
 * Append a migration env suffix to a rule id. Optionally a numeric
 * disambiguator for pathological legacy data where the same legacy id
 * appeared more than once within a single environment's rule list.
 *
 *   suffixRuleId("fr_abc", "dev")       → "fr_abc__dev"
 *   suffixRuleId("fr_abc", "dev", 2)    → "fr_abc__dev__2"
 *
 * The input `stem` MUST be unsuffixed. Passing an already-suffixed id is a
 * programming error (would produce `fr_abc__dev__production`). Callers that
 * cannot guarantee this should `stemRuleId` first.
 */
export function suffixRuleId(
  stem: string,
  environment: string,
  occurrence?: number,
): string {
  const base = `${stem}${RULE_ID_ENV_SUFFIX_DELIMITER}${environment}`;
  if (occurrence === undefined || occurrence <= 1) return base;
  return `${base}${RULE_ID_ENV_SUFFIX_DELIMITER}${occurrence}`;
}

/**
 * True iff the id carries a migration-added suffix. Useful for UI callouts
 * (e.g. "this rule's id was disambiguated during environment-tag migration")
 * and for diagnostics.
 */
export function isMigrationSuffixedRuleId(id: string): boolean {
  return id.includes(RULE_ID_ENV_SUFFIX_DELIMITER);
}
