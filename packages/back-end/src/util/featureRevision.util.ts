import { FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

/**
 * In-memory version of the rule overlay applied by `editFeatureRules` /
 * `updateRevision`. Used to preflight merges. Rules are matched by `rule.id`;
 * unknown ids are ignored and duplicates in `ruleIds` are idempotent.
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
