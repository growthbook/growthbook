import cloneDeep from "lodash/cloneDeep";
import { FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

/**
 * Applies the same rule overlay as `editFeatureRules` / `updateRevision` would,
 * without persisting. Used to preflight merges and keep logic aligned with
 * `editFeatureRules` in FeatureModel.
 */
export function applyPartialFeatureRuleUpdatesToRevision(
  revision: FeatureRevisionInterface,
  matches: { environmentId: string; i: number }[],
  updates: Partial<FeatureRule>,
): FeatureRevisionInterface {
  const nextRules = revision.rules ? cloneDeep(revision.rules) : {};

  matches.forEach(({ environmentId, i }) => {
    nextRules[environmentId] = nextRules[environmentId] || [];
    if (!nextRules[environmentId][i]) {
      throw new Error("Unknown rule");
    }
    nextRules[environmentId][i] = {
      ...nextRules[environmentId][i],
      ...updates,
    } as FeatureRule;
  });

  return {
    ...revision,
    rules: nextRules,
    status: revision.status,
  };
}
