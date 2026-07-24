import type { z } from "zod";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { postFeatureRuleV2 } from "shared/validators";
import {
  validateScheduleRules,
  setConfigBacking,
  getConfigBackingKey,
  getConfigSubtree,
  isScopedConfig,
  valueHasConfigExtends,
  parsePlainJSONObject,
} from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";
import { BadRequestError } from "back-end/src/util/errors";
import type { ApiFeatureEnvSettings } from "./postFeature";

// A flag can't carry its own JSON schema while it's a config-backed ("Config
// mode") flag — the config's schema is authoritative, so the two would conflict.
// Config-backing is determined solely by `baseConfig` (the authoritative field),
// never by sniffing the value's `$extends`. Pass the *effective* post-update
// `baseConfig` (new value falling back to the existing one).
export function assertConfigSchemaCompat({
  jsonSchemaEnabled,
  baseConfig,
}: {
  jsonSchemaEnabled: boolean | undefined;
  baseConfig?: string | null;
}): void {
  if (jsonSchemaEnabled && (baseConfig ?? null) !== null) {
    throw new BadRequestError(
      "A flag cannot define its own JSON schema while it is backed by a config (`baseConfig`). " +
        "The config's schema is authoritative — remove `baseConfig` or the flag's jsonSchema.",
    );
  }
}

// Matches the key charset the payload resolver accepts (`@config:<key>` refs).
const CONFIG_KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

async function requireLiveConfig(
  context: ApiReqContext,
  key: string,
  featureProject: string | undefined,
): Promise<void> {
  if (!CONFIG_KEY_RE.test(key)) {
    throw new BadRequestError(
      `Invalid config key "${key}". Keys must be lowercase alphanumeric with hyphens/underscores.`,
    );
  }
  const config = await context.models.configs.getByKey(key);
  if (!config) {
    throw new BadRequestError(`Config "${key}" does not exist.`);
  }
  if (config.archived) {
    throw new BadRequestError(
      `Config "${key}" is archived and cannot back a feature value.`,
    );
  }
  // Resolution scrubs a ref whose config is scoped to a different project than
  // the resolving feature, so a cross-project attach would serve a bare patch
  // while its values are validated against a schema that never applies. Global
  // configs (no project) are usable everywhere. Matches the UI's config picker.
  if (config.project && config.project !== (featureProject || "")) {
    throw new BadRequestError(
      `Config "${key}" is scoped to a different project than this feature and cannot back its values. Use a global config or one in the feature's project.`,
    );
  }
  // Flavors are selected implicitly per environment via the base's
  // scopedOverrides — referencing one directly would serve its patch in EVERY
  // environment and dodge its env-scoped review.
  if (isScopedConfig(config)) {
    throw new BadRequestError(
      `Config "${key}" is an environment/project override of "${config.scopedConfig?.parent}" and can't back a feature value directly — reference its base config instead.`,
    );
  }
}

// Config backing is set only through dedicated fields (`baseConfig`,
// `defaultValueConfig`, rule/variation `config`) — never a raw `@config:`
// `$extends` inside a value string. `@const:` refs are untouched.
export function assertNoRawConfigExtends(
  value: string | undefined,
  label: string,
): void {
  if (valueHasConfigExtends(value)) {
    throw new BadRequestError(
      `${label} must not embed a config via a raw "$extends" "@config:" directive. Use the config field instead (baseConfig / defaultValueConfig / a rule's config).`,
    );
  }
}

// Compose a stored config-backed value from a config key + an override patch,
// rejecting a patch that isn't a JSON object. A config backing is a deep-merge
// of the patch onto the config's object, so a scalar/array patch has nothing to
// merge onto — setConfigBacking would silently drop the backing ref and store
// the bare value unbacked. Reject the contradictory input instead. An empty
// patch ("" / whitespace) is fine: it means "pure backing, no override".
export function composeConfigBacking(
  configKey: string | null | undefined,
  value: string | undefined,
  label: string,
): string {
  if (
    (configKey ?? null) !== null &&
    (value ?? "").trim() !== "" &&
    !parsePlainJSONObject(value ?? "")
  ) {
    throw new BadRequestError(
      `${label} must be a JSON object when backed by a config — a scalar or array value can't extend a config.`,
    );
  }
  return setConfigBacking(configKey ?? null, value);
}

// `baseConfig` puts a flag in Config mode: JSON-typed and backed by a live config.
export async function assertValidBaseConfig(
  context: ApiReqContext,
  baseConfig: string | null | undefined,
  valueType: string | undefined,
  featureProject: string | undefined,
): Promise<void> {
  if ((baseConfig ?? null) === null) return;
  if (valueType !== "json") {
    throw new BadRequestError('`baseConfig` requires `valueType: "json"`.');
  }
  await requireLiveConfig(context, baseConfig as string, featureProject);
}

// The default's optional extension must be a live config within `baseConfig`'s
// family (the base itself or a descendant).
export async function assertValidDefaultValueConfig(
  context: ApiReqContext,
  baseConfig: string | null | undefined,
  defaultValueConfig: string | null | undefined,
  featureProject: string | undefined,
): Promise<void> {
  if ((defaultValueConfig ?? null) === null) return;
  if ((baseConfig ?? null) === null) {
    throw new BadRequestError(
      "`defaultValueConfig` requires `baseConfig` to be set.",
    );
  }
  await requireLiveConfig(
    context,
    defaultValueConfig as string,
    featureProject,
  );
  const allConfigs = await context.models.configs.getAll();
  const family = new Set(getConfigSubtree(baseConfig as string, allConfigs));
  if (!family.has(defaultValueConfig as string)) {
    throw new BadRequestError(
      `Config "${defaultValueConfig}" is not the feature's baseConfig "${baseConfig}" or one of its descendants.`,
    );
  }
}

// Request-supplied config keys on rules/variations must resolve to a live
// config within the feature's family: the default value's backing config or a
// descendant of it (mirrors the UI's getConfigSubtree constraint). `null`
// (detach) and `undefined` (no change) entries are skipped.
export async function assertValidRuleConfigKeys(
  context: ApiReqContext,
  configKeys: (string | null | undefined)[],
  effectiveDefaultValue: string | undefined,
  baseConfig: string | null | undefined,
  featureProject: string | undefined,
): Promise<void> {
  const keys = [
    ...new Set(configKeys.filter((k): k is string => typeof k === "string")),
  ];
  if (!keys.length) return;

  for (const key of keys) {
    await requireLiveConfig(context, key, featureProject);
  }

  const defaultConfigKey =
    (baseConfig ?? null) !== null
      ? (baseConfig ?? null)
      : getConfigBackingKey(effectiveDefaultValue);
  if (defaultConfigKey === null) {
    throw new BadRequestError(
      "Rule values can only reference a config when the feature's default value is config-backed.",
    );
  }
  const allConfigs = await context.models.configs.getAll();
  const family = new Set(getConfigSubtree(defaultConfigKey, allConfigs));
  for (const key of keys) {
    if (!family.has(key)) {
      throw new BadRequestError(
        `Config "${key}" is not the feature's default config "${defaultConfigKey}" or one of its descendants.`,
      );
    }
  }
}

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

// Project-scope resolution mirroring resolveScopeFromInput. Default allProjects:true;
// allProjects:false keeps an explicit projects list (empty = scoped to nothing, leak-safe).
export function resolveProjectScopeFromInput(
  allProjects: boolean | undefined,
  projects: string[] | undefined,
): { allProjects: boolean; projects: string[] | undefined } {
  if (allProjects === true) {
    return { allProjects: true, projects: undefined };
  }
  if (allProjects === false) {
    return { allProjects: false, projects: projects ?? [] };
  }
  if (Array.isArray(projects)) {
    return { allProjects: false, projects };
  }
  return { allProjects: true, projects: undefined };
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
  const { allEnvironments, environments, allProjects, projects, ...ruleInput } =
    r;
  const { allEnvironments: resolvedAllEnvs, environments: resolvedEnvs } =
    resolveScopeFromInput(allEnvironments, environments);
  const { allProjects: resolvedAllProjects, projects: resolvedProjects } =
    resolveProjectScopeFromInput(allProjects, projects);
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
    allProjects: resolvedAllProjects,
    projects: resolvedProjects,
  };

  if (ruleInput.type === "experiment-ref") {
    return {
      ...baseRule,
      type: "experiment-ref" as const,
      experimentId: ruleInput.experimentId,
      variations: ruleInput.variations.map((v) => {
        assertNoRawConfigExtends(v.value, "Variation value");
        // When `config` is supplied, `value` is an override patch; recompose it
        // into the internal `$extends`-first value. null detaches any config.
        return {
          variationId: v.variationId,
          value:
            v.config !== undefined
              ? composeConfigBacking(v.config, v.value, "Variation value")
              : v.value,
        };
      }),
      ...(ruleInput.sparse !== undefined && { sparse: ruleInput.sparse }),
    };
  }
  if (ruleInput.type === "rollout") {
    assertNoRawConfigExtends(ruleInput.value, "Rule value");
    return {
      ...baseRule,
      type: "rollout" as const,
      value:
        ruleInput.config !== undefined
          ? composeConfigBacking(
              ruleInput.config,
              ruleInput.value,
              "Rule value",
            )
          : ruleInput.value,
      ...(ruleInput.sparse !== undefined && { sparse: ruleInput.sparse }),
      coverage: ruleInput.coverage ?? 1,
      hashAttribute: ruleInput.hashAttribute ?? "",
      // Preserve bucketing inputs on round-trips: dropping them would let
      // the seed backfill (or the hashVersion default) re-bucket the rollout.
      ...(ruleInput.seed !== undefined && { seed: ruleInput.seed }),
      ...(ruleInput.hashVersion !== undefined && {
        hashVersion: ruleInput.hashVersion,
      }),
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
  assertNoRawConfigExtends(ruleInput.value, "Rule value");
  return {
    ...baseRule,
    type: "force" as const,
    value:
      ruleInput.config !== undefined
        ? composeConfigBacking(ruleInput.config, ruleInput.value, "Rule value")
        : ruleInput.value,
    ...(ruleInput.sparse !== undefined && { sparse: ruleInput.sparse }),
  };
}

// Fields tracked on a revision's metadata rather than directly on the feature.
const METADATA_FIELDS = [
  "owner",
  "description",
  "project",
  "targetingAllProjects",
  "targetingProjects",
  "tags",
  "customFields",
  "jsonSchema",
  "baseConfig",
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

// Validate that every targeting project id exists (mirrors the primary-project check).
export async function assertValidProjectIds(
  projectIds: string[] | undefined,
  context: ReqContext | ApiReqContext,
  label = "targeting",
): Promise<void> {
  if (!projectIds?.length) return;
  const valid = new Set((await context.getProjects()).map((p) => p.id));
  const missing = projectIds.filter((id) => id && !valid.has(id));
  if (missing.length) {
    throw new Error(
      `The following ${label} project ids are not valid: ${missing.join(", ")}`,
    );
  }
}

// Validate every rule-level project scope id across a set of rules.
export async function assertValidRuleProjectIds(
  rules: { projects?: string[] }[] | undefined,
  context: ReqContext | ApiReqContext,
): Promise<void> {
  const ids = Array.from(
    new Set((rules ?? []).flatMap((r) => r.projects ?? [])),
  );
  await assertValidProjectIds(ids, context, "rule");
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
