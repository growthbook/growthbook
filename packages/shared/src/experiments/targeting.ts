import type {
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "shared/validators";

/**
 * An empty attribute-targeting condition is stored as the string "{}".
 * Returns true only when a non-empty condition is configured.
 */
export function hasAttributeCondition(condition?: string): boolean {
  return !!condition && condition !== "{}";
}

/**
 * Whether an experiment phase (or feature rule) has any targeting configured:
 * an attribute condition, saved group targeting, or prerequisites.
 */
export function hasTargetingConfigured(target?: {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
}): boolean {
  if (!target) return false;
  return (
    hasAttributeCondition(target.condition) ||
    !!target.savedGroups?.length ||
    !!target.prerequisites?.length
  );
}
