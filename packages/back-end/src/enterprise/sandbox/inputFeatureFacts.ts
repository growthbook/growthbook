import { featureValueType } from "shared/validators";
import { valueHasConfigExtends } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { overlayDocsById } from "back-end/src/util/scanOverlay.util";

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

// A bulk publish's proposed flag states win over saved ones, so a hook never
// approves a change against an input flag the same publish is changing.
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
