import { FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

/**
 * In-memory version of the rule overlay applied by `editFeatureRules` /
 * `updateRevision`. Used to preflight merges. Rules are matched by `rule.id`;
 * unknown ids are ignored and duplicates in `ruleIds` are idempotent.
 *
 * Defensive: pre-v2 docs persisted via Mongoose `Mixed` can carry sparse
 * `null`/`undefined` rule slots. JIT-boundary filters strip them on read,
 * but the overlay is reachable from auto-publish preflight so we skip
 * nullish slots here too rather than crashing on `r.id`.
 */
export function applyPartialFeatureRuleUpdatesToRevision(
  revision: FeatureRevisionInterface,
  ruleIds: string[],
  updates: Partial<FeatureRule>,
): FeatureRevisionInterface {
  if (ruleIds.length === 0) return revision;
  const matchSet = new Set(ruleIds);
  const nextRules = (revision.rules ?? [])
    .filter((r): r is FeatureRule => r != null && typeof r === "object")
    .map((r) =>
      r.id && matchSet.has(r.id) ? ({ ...r, ...updates } as FeatureRule) : r,
    );
  return {
    ...revision,
    rules: nextRules,
    status: revision.status,
  };
}
