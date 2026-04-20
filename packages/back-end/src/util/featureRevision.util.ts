import { FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

/**
 * Applies the same rule overlay as `editFeatureRules` / `updateRevision` would,
 * without persisting. Used to preflight merges and keep logic aligned with
 * `editFeatureRules` in FeatureModel.
 *
 * Post-Phase-3 contract: rules are matched by `rule.id` on the v2 unified
 * `revision.rules` array. Passing the same `ruleId` multiple times is
 * idempotent (the first match wins; subsequent duplicates are no-ops). Rules
 * present in `ruleIds` but absent from the revision are ignored silently —
 * the old v1 "throw on unknown rule" behavior (which keyed on [env, index])
 * is dropped because there is no stable invariant to enforce under a
 * possibly-sparse concurrent edit.
 */
export function applyPartialFeatureRuleUpdatesToRevision(
  revision: FeatureRevisionInterface,
  ruleIds: string[],
  updates: Partial<FeatureRule>,
): FeatureRevisionInterface {
  if (ruleIds.length === 0) return revision;
  const matchSet = new Set(ruleIds);
  const nextRules = (revision.rules ?? []).map((r) =>
    matchSet.has(r.id) ? ({ ...r, ...updates } as FeatureRule) : r,
  );
  return {
    ...revision,
    rules: nextRules,
    status: revision.status,
  };
}
