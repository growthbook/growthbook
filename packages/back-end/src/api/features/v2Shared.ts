import type { z } from "zod";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { postFeatureRuleV2 } from "shared/validators";
import { validateScheduleRules } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import type { ApiFeatureEnvSettings } from "./postFeature";

export type ApiRuleV2Input = z.infer<typeof postFeatureRuleV2>;

/**
 * Convert a v2 API rule input (from POST/PUT bodies) to the internal
 * `FeatureRule` shape. Scope fields are preserved verbatim; `id` is left
 * blank for new rules and filled in later by `addIdsToFlatRules`.
 *
 * Shared between `postFeatureV2` and `updateFeatureV2`.
 */
export function mapV2ApiRuleToFeatureRule(r: ApiRuleV2Input): FeatureRule {
  const { allEnvironments, environments, ...ruleInput } = r;
  const baseRule = {
    id: ruleInput.id ?? "",
    description: ruleInput.description ?? "",
    enabled: ruleInput.enabled ?? true,
    condition: ruleInput.condition ?? "",
    savedGroups: ruleInput.savedGroupTargeting?.map((s) => ({
      match: s.matchType,
      ids: s.savedGroups,
    })),
    scheduleRules: ruleInput.scheduleRules,
    allEnvironments: allEnvironments ?? true,
    environments: allEnvironments ? undefined : (environments ?? []),
  };

  if (ruleInput.type === "experiment-ref") {
    return {
      ...baseRule,
      type: "experiment-ref" as const,
      experimentId: ruleInput.experimentId,
      variations: ruleInput.variations.map((v) => ({
        variationId: v.variationId,
        value: v.value,
      })),
    };
  }
  if (ruleInput.type === "rollout") {
    return {
      ...baseRule,
      type: "rollout" as const,
      value: ruleInput.value,
      coverage: ruleInput.coverage ?? 1,
      hashAttribute: ruleInput.hashAttribute ?? "",
    };
  }
  return {
    ...baseRule,
    type: "force" as const,
    value: ruleInput.value,
  };
}

// Fields that belong on a revision's `metadata` object rather than
// directly on the feature. Shared by v1/v2 update handlers.
const METADATA_FIELDS = [
  "owner",
  "description",
  "project",
  "tags",
  "customFields",
  "jsonSchema",
] as const;

/**
 * Move any metadata-like fields from `updates` into a separate
 * `metadataChanges` object, mutating `updates` to remove them. Keeps v1/v2
 * update handlers in sync on which fields are revision-tracked.
 */
export function extractRevisionMetadata(
  updates: Partial<FeatureInterface>,
): Record<string, unknown> {
  const metadataChanges: Record<string, unknown> = {};
  for (const key of METADATA_FIELDS) {
    if (key in updates && updates[key] !== undefined) {
      metadataChanges[key] = updates[key];
      delete (updates as Record<string, unknown>)[key];
    }
  }
  return metadataChanges;
}

/**
 * Throw if `projectId` is provided but doesn't match any project the org has
 * access to. Shared by feature POST/PUT handlers.
 */
export async function assertValidProjectId(
  projectId: string | undefined | null,
  context: ApiReqContext,
): Promise<void> {
  if (!projectId) return;
  const projects = await context.getProjects();
  if (!projects.some((p) => p.id === projectId)) {
    throw new Error(`Project id ${projectId} is not a valid project.`);
  }
}

/**
 * Throw if the request sets a holdout that doesn't exist. Accepts the
 * nullable body shape used by v1/v2 update handlers. `null` (intentional
 * removal) and `undefined` (no change) are both no-ops.
 */
export async function assertValidHoldout(
  holdout: { id: string } | null | undefined,
  context: ApiReqContext,
): Promise<void> {
  if (!holdout) return;
  const holdoutObj = await context.models.holdout.getById(holdout.id);
  if (!holdoutObj) {
    throw new Error(`Holdout id '${holdout.id}' not found.`);
  }
}

/**
 * Validate `scheduleRules` on any v1-shape environment rules in the request
 * body. Pro/Enterprise gated. Shared by `postFeature` and `updateFeature`.
 */
export function validateEnvRulesScheduleRules(
  envBody: ApiFeatureEnvSettings | undefined,
  context: ApiReqContext,
): void {
  if (!envBody) return;
  for (const [envName, envSettings] of Object.entries(envBody)) {
    if (!envSettings.rules) continue;
    envSettings.rules.forEach((rule, ruleIndex) => {
      if (!rule.scheduleRules) return;
      if (!context.hasPremiumFeature("schedule-feature-flag")) {
        throw new Error(
          "This organization does not have access to schedule rules. Upgrade to Pro or Enterprise.",
        );
      }
      try {
        validateScheduleRules(rule.scheduleRules);
      } catch (error) {
        throw new Error(
          `Invalid scheduleRules in environment "${envName}", rule ${
            ruleIndex + 1
          }: ${error.message}`,
        );
      }
    });
  }
}
