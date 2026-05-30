import type { z } from "zod";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { postFeatureRuleV2 } from "shared/validators";
import { validateScheduleRules } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import type { ApiFeatureEnvSettings } from "./postFeature";

export type ApiRuleV2Input = z.infer<typeof postFeatureRuleV2>;

// Resolve a v2 scope payload to a canonical `{ allEnvironments, environments }`
// pair. Inference rules:
//   - allEnvironments:true                        → all envs, drop environments[]
//   - allEnvironments:false                       → single/multi-env list (default [])
//   - undefined + environments:[...]              → infer allEnvironments:false
//   - undefined + undefined                       → default to allEnvironments:true
// The contradictory `{ allEnvironments:true, environments:[...] }` is normalized
// in favor of allEnvironments:true (environments[] dropped).
export function resolveScopeFromInput(
  allEnvironments: boolean | undefined,
  environments: string[] | undefined,
): { allEnvironments: boolean; environments: string[] | undefined } {
  if (allEnvironments === true) {
    return { allEnvironments: true, environments: undefined };
  }
  if (allEnvironments === false) {
    return { allEnvironments: false, environments: environments ?? [] };
  }
  if (Array.isArray(environments)) {
    return { allEnvironments: false, environments };
  }
  return { allEnvironments: true, environments: undefined };
}

// Convert a v2 API rule input to the internal `FeatureRule` shape. New rules
// leave `id` blank; `addIdsToFlatRules` fills it in downstream.
//
// Safe-rollout is preserve-only: the SafeRollout entity must already exist on
// `existingFeature` under the same `safeRolloutId`. New safe-rollouts must
// go through `POST /v2/features/:id/revisions/:version/rules` because they
// require entity creation + datasource validation + compensation orchestration
// outside the bulk-PUT path.
export function mapV2ApiRuleToFeatureRule(
  r: ApiRuleV2Input,
  existingFeature?: FeatureInterface,
): FeatureRule {
  const { allEnvironments, environments, ...ruleInput } = r;
  const { allEnvironments: resolvedAllEnvs, environments: resolvedEnvs } =
    resolveScopeFromInput(allEnvironments, environments);
  const baseRule = {
    id: ruleInput.id ?? "",
    description: ruleInput.description ?? "",
    enabled: ruleInput.enabled ?? true,
    condition: ruleInput.condition ?? "",
    savedGroups: ruleInput.savedGroupTargeting?.map((s) => ({
      match: s.matchType,
      ids: s.savedGroups,
    })),
    allEnvironments: resolvedAllEnvs,
    environments: resolvedEnvs,
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
  if (ruleInput.type === "safe-rollout") {
    const existing = (existingFeature?.rules ?? []).find(
      (er) =>
        er.type === "safe-rollout" &&
        er.safeRolloutId === ruleInput.safeRolloutId,
    );
    if (!existing) {
      throw new BadRequestError(
        `safeRolloutId "${ruleInput.safeRolloutId}" does not match any existing safe-rollout rule on this feature. Bulk POST/PUT cannot create new safe-rollouts; use POST /v2/features/:id/revisions/:version/rules.`,
      );
    }
    const existingSafeRollout = existing as Extract<
      FeatureRule,
      { type: "safe-rollout" }
    >;
    return {
      ...baseRule,
      type: "safe-rollout" as const,
      controlValue: ruleInput.controlValue,
      variationValue: ruleInput.variationValue,
      hashAttribute: ruleInput.hashAttribute,
      trackingKey: ruleInput.trackingKey ?? existingSafeRollout.trackingKey,
      seed: ruleInput.seed ?? existingSafeRollout.seed,
      safeRolloutId: ruleInput.safeRolloutId,
      status: ruleInput.status ?? existingSafeRollout.status,
    };
  }
  return {
    ...baseRule,
    type: "force" as const,
    value: ruleInput.value,
  };
}

// Fields tracked on a revision's metadata rather than directly on the feature.
const METADATA_FIELDS = [
  "owner",
  "description",
  "project",
  "tags",
  "customFields",
  "jsonSchema",
] as const;

// Pure split of metadata-like fields from feature updates. Returns the
// metadata subset and a copy of `updates` with those keys removed.
export function extractRevisionMetadata(updates: Partial<FeatureInterface>): {
  metadata: Record<string, unknown>;
  remaining: Partial<FeatureInterface>;
} {
  const metadata: Record<string, unknown> = {};
  const remaining: Partial<FeatureInterface> = { ...updates };
  for (const key of METADATA_FIELDS) {
    if (key in remaining && remaining[key] !== undefined) {
      metadata[key] = remaining[key];
      delete (remaining as Record<string, unknown>)[key];
    }
  }
  return { metadata, remaining };
}

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

// `null` (explicit removal) and `undefined` (no change) are both no-ops.
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

// Pro/Enterprise gated. Validates scheduleRules on v1-shape env rules.
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
