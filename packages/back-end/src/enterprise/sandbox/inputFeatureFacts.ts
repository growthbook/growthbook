import { CustomHookInterface, featureValueType } from "shared/validators";
import { valueHasConfigExtends } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { overlayDocsById } from "back-end/src/util/scanOverlay.util";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { Context } from "back-end/src/models/BaseModel";

export type HookInputFeatureFacts = {
  project: string;
  archived: boolean;
  valueType: string;
  booleanDefault: boolean | null;
  hasPrerequisites: boolean;
  hasConfig: boolean;
  hasHoldout: boolean;
  environments: Record<string, { enabled: boolean; hasRules: boolean }>;
};

// Stored docs aren't guaranteed to match the schema, so every field is read as
// unknown and a malformed one gets the cautious answer: present, has rules, or
// not enabled.
function hasItems(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return !Array.isArray(value) || value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Disabled and scheduled rules still count: they are configured on the env.
function ruleTargetsEnv(rule: unknown, env: string): boolean {
  const r = asRecord(rule);
  if (!r) return rule !== null && rule !== undefined;
  if (r.allEnvironments === true) return true;
  if (r.environments === undefined) return true;
  return !Array.isArray(r.environments) || r.environments.includes(env);
}

export function buildHookInputFeatureFacts(
  feature: FeatureInterface,
  environmentIds: string[],
): HookInputFeatureFacts {
  const raw: Record<string, unknown> = feature;
  const valueType =
    typeof raw.valueType === "string" &&
    (featureValueType as readonly string[]).includes(raw.valueType)
      ? raw.valueType
      : "";

  const defaultValue =
    typeof raw.defaultValue === "string" ? raw.defaultValue : undefined;
  const booleanDefault =
    valueType === "boolean" &&
    (defaultValue === "true" || defaultValue === "false")
      ? defaultValue === "true"
      : null;

  const envSettings = asRecord(raw.environmentSettings);
  const hasPrerequisites =
    hasItems(raw.prerequisites) ||
    (envSettings
      ? Object.values(envSettings).some((s) => {
          const settings = asRecord(s);
          return settings
            ? hasItems(settings.prerequisites)
            : s !== undefined && s !== null;
        })
      : raw.environmentSettings !== undefined &&
        raw.environmentSettings !== null);

  const baseConfig = raw.baseConfig;
  const hasConfig =
    (baseConfig !== undefined && baseConfig !== null && baseConfig !== "") ||
    (defaultValue !== undefined && valueHasConfigExtends(defaultValue));

  const holdout = raw.holdout;
  const hasHoldout =
    holdout !== undefined && holdout !== null && asRecord(holdout)?.id !== "";

  const rules = raw.rules;
  const environments: HookInputFeatureFacts["environments"] = {};
  for (const env of environmentIds) {
    environments[env] = {
      enabled: asRecord(envSettings?.[env])?.enabled === true,
      hasRules: Array.isArray(rules)
        ? rules.some((rule) => ruleTargetsEnv(rule, env))
        : rules !== undefined && rules !== null,
    };
  }

  return {
    project: typeof raw.project === "string" ? raw.project : "",
    archived: raw.archived === true,
    valueType,
    booleanDefault,
    hasPrerequisites,
    hasConfig,
    hasHoldout,
    environments,
  };
}

// Other flags' proposed states in the same bulk publish win over their saved
// ones. The overlay never holds the flag being validated, so a hook that lists
// its own flag sees that flag's saved state.
export function buildInputFeatureFactsById(
  saved: FeatureInterface[],
  overlay: Map<string, FeatureInterface> | null | undefined,
  environmentIds: string[],
): Map<string, HookInputFeatureFacts> {
  return new Map(
    overlayDocsById(saved, overlay).map((feature) => [
      feature.id,
      buildHookInputFeatureFacts(feature, environmentIds),
    ]),
  );
}

// One read per batch, under an org-wide scan context (all projects), so the
// facts don't depend on who made the change. A failed read fails the change.
export async function loadInputFeatureFacts(
  scanContext: Context,
  hooks: Pick<CustomHookInterface, "inputFeatures">[],
): Promise<Map<string, HookInputFeatureFacts>> {
  const ids = [...new Set(hooks.flatMap((h) => h.inputFeatures ?? []))];
  if (!ids.length) return new Map();
  return buildInputFeatureFactsById(
    await getFeaturesByIds(scanContext, ids),
    scanContext.featureScanOverlay,
    getEnvironmentIdsFromOrg(scanContext.org),
  );
}

// Hooks with no listed flags get exactly their old arguments. A listed id with
// no flag maps to null.
export function withInputFeatureFacts(
  hook: Pick<CustomHookInterface, "inputFeatures">,
  facts: Map<string, HookInputFeatureFacts>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!hook.inputFeatures?.length) return args;
  return {
    ...args,
    inputFeatureFacts: Object.fromEntries(
      hook.inputFeatures.map((id) => [id, facts.get(id) ?? null]),
    ),
  };
}
