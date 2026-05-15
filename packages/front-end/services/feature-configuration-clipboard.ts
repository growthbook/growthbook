import {
  GrowthBookClipboardReferenceContext,
  GrowthBookFeatureClipboardFeature,
  GrowthBookFeatureClipboardPayload,
  GrowthBookFeatureClipboardReferences,
  growthbookFeatureClipboardPayload,
} from "shared/validators";
import { FeatureInterface, FeatureRule } from "shared/types/feature";

export const FEATURE_CONFIGURATION_CLIPBOARD_VERSION = 1;

export type FeatureReferenceCategory =
  | "experiments"
  | "savedGroups"
  | "safeRollouts"
  | "features"
  | "environments";

export type FeatureReferenceMappings = Record<
  FeatureReferenceCategory,
  Record<string, string>
>;

export const EMPTY_FEATURE_REFERENCE_MAPPINGS: FeatureReferenceMappings = {
  experiments: {},
  savedGroups: {},
  safeRollouts: {},
  features: {},
  environments: {},
};

// Lookup context the exporter uses to enrich each referenced id with a
// human-readable name. The caller passes whatever it has — anything missing
// just leaves `name` undefined on that reference.
export type FeatureReferenceLookups = {
  experiments?: Map<string, { name?: string; hypothesis?: string }>;
  savedGroups?: Map<
    string,
    { groupName?: string; type?: string; attributeKey?: string }
  >;
  safeRollouts?: Map<string, { featureId?: string; environment?: string }>;
  features?: Map<string, { id: string; description?: string }>;
  environments?: Map<string, { description?: string }>;
};

export function featureToClipboardConfiguration(
  feature: FeatureInterface,
): GrowthBookFeatureClipboardFeature {
  return {
    id: feature.id,
    description: feature.description,
    project: feature.project,
    valueType: feature.valueType,
    defaultValue: feature.defaultValue,
    tags: feature.tags,
    environmentSettings: feature.environmentSettings,
    rules: feature.rules ?? [],
    customFields: feature.customFields,
    jsonSchema: feature.jsonSchema,
    neverStale: feature.neverStale,
  };
}

// Walks the feature config and pulls out every id that points at something
// living in another collection — experiments, saved groups, safe rollouts,
// prerequisite features, and environments (rule scoping + envSettings keys).
export function extractFeatureReferenceIds(
  feature: GrowthBookFeatureClipboardFeature,
): Record<FeatureReferenceCategory, Set<string>> {
  const ids: Record<FeatureReferenceCategory, Set<string>> = {
    experiments: new Set(),
    savedGroups: new Set(),
    safeRollouts: new Set(),
    features: new Set(),
    environments: new Set(),
  };

  const walkConditionForSavedGroups = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walkConditionForSavedGroups);
      return;
    }
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (
        (key === "$inGroup" || key === "$notInGroup") &&
        typeof value === "string"
      ) {
        ids.savedGroups.add(value);
      } else {
        walkConditionForSavedGroups(value);
      }
    }
  };

  feature.rules.forEach((rule) => {
    if (rule.type === "experiment-ref" && rule.experimentId) {
      ids.experiments.add(rule.experimentId);
    }
    if (rule.type === "safe-rollout" && rule.safeRolloutId) {
      ids.safeRollouts.add(rule.safeRolloutId);
    }
    (rule.savedGroups ?? []).forEach((sg) => {
      (sg.ids ?? []).forEach((id) => ids.savedGroups.add(id));
    });
    (rule.prerequisites ?? []).forEach((prereq) => {
      if (prereq.id) ids.features.add(prereq.id);
    });
    if (rule.condition) {
      try {
        walkConditionForSavedGroups(JSON.parse(rule.condition));
      } catch {
        // Conditions that aren't valid JSON have no saved group refs to
        // extract — silently skip them.
      }
    }
    // Rule env scope — only meaningful when allEnvironments is false; with
    // the wildcard set, environments[] is ignored at evaluation.
    if (!rule.allEnvironments && rule.environments?.length) {
      rule.environments.forEach((env) => ids.environments.add(env));
    }
  });

  Object.keys(feature.environmentSettings ?? {}).forEach((env) =>
    ids.environments.add(env),
  );

  return ids;
}

function buildReferenceManifest(
  feature: GrowthBookFeatureClipboardFeature,
  lookups: FeatureReferenceLookups,
): GrowthBookFeatureClipboardReferences {
  const ids = extractFeatureReferenceIds(feature);

  const experiments: GrowthBookClipboardReferenceContext[] = [];
  ids.experiments.forEach((id) => {
    const exp = lookups.experiments?.get(id);
    experiments.push({ id, name: exp?.name, details: exp?.hypothesis });
  });

  const savedGroups: GrowthBookClipboardReferenceContext[] = [];
  ids.savedGroups.forEach((id) => {
    const sg = lookups.savedGroups?.get(id);
    const detailsParts = [
      sg?.type ? `type: ${sg.type}` : null,
      sg?.attributeKey ? `attribute: ${sg.attributeKey}` : null,
    ].filter(Boolean);
    savedGroups.push({
      id,
      name: sg?.groupName,
      details: detailsParts.length ? detailsParts.join(" • ") : undefined,
    });
  });

  const safeRollouts: GrowthBookClipboardReferenceContext[] = [];
  ids.safeRollouts.forEach((id) => {
    const sr = lookups.safeRollouts?.get(id);
    const detailsParts = [
      sr?.featureId ? `feature: ${sr.featureId}` : null,
      sr?.environment ? `env: ${sr.environment}` : null,
    ].filter(Boolean);
    safeRollouts.push({
      id,
      // Safe rollouts have no `name` field; use feature/env as a stand-in.
      name:
        sr?.featureId && sr?.environment
          ? `${sr.featureId} (${sr.environment})`
          : undefined,
      details: detailsParts.length ? detailsParts.join(" • ") : undefined,
    });
  });

  const features: GrowthBookClipboardReferenceContext[] = [];
  ids.features.forEach((id) => {
    const feat = lookups.features?.get(id);
    features.push({ id, name: feat?.id, details: feat?.description });
  });

  const environments: GrowthBookClipboardReferenceContext[] = [];
  ids.environments.forEach((id) => {
    const env = lookups.environments?.get(id);
    environments.push({ id, name: env?.description || undefined });
  });

  return { experiments, savedGroups, safeRollouts, features, environments };
}

export function buildFeatureConfigurationClipboardPayload(
  feature: FeatureInterface,
  lookups: FeatureReferenceLookups = {},
): string {
  const featureConfig = featureToClipboardConfiguration(feature);
  const payload: GrowthBookFeatureClipboardPayload = {
    growthbook: {
      source: "growthbook",
      object: "feature",
      version: FEATURE_CONFIGURATION_CLIPBOARD_VERSION,
      exportedAt: new Date().toISOString(),
    },
    feature: featureConfig,
    references: buildReferenceManifest(featureConfig, lookups),
  };

  return JSON.stringify(payload, null, 2);
}

export function parseFeatureConfigurationClipboardPayload(
  text: string,
): GrowthBookFeatureClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const result = growthbookFeatureClipboardPayload.safeParse(parsed);
  return result.success ? result.data : null;
}

// Rewrites every reference id in a rule to its mapped target. Conditions are
// re-serialized through JSON.parse/stringify so embedded $inGroup ids get
// swapped too. Refs that aren't in the mapping are left alone — callers
// (i.e. the mapping modal) are responsible for ensuring full coverage.
function applyMappingsToRule(
  rule: FeatureRule,
  mappings: FeatureReferenceMappings,
): FeatureRule {
  const next: FeatureRule = { ...rule };

  if (next.type === "experiment-ref" && next.experimentId) {
    const mapped = mappings.experiments[next.experimentId];
    if (mapped) next.experimentId = mapped;
  }
  if (next.type === "safe-rollout" && next.safeRolloutId) {
    const mapped = mappings.safeRollouts[next.safeRolloutId];
    if (mapped) next.safeRolloutId = mapped;
  }

  if (next.savedGroups?.length) {
    next.savedGroups = next.savedGroups.map((sg) => ({
      ...sg,
      ids: (sg.ids ?? []).map((id) => mappings.savedGroups[id] ?? id),
    }));
  }

  if (next.prerequisites?.length) {
    next.prerequisites = next.prerequisites.map((p) => ({
      ...p,
      id: mappings.features[p.id] ?? p.id,
    }));
  }

  // Rule env scope: rewrite when the rule isn't a wildcard. Falls back to the
  // original id so an unmapped env still passes the env-validity check on the
  // back-end with whatever was on the clipboard.
  if (!next.allEnvironments && next.environments?.length) {
    next.environments = next.environments.map(
      (env) => mappings.environments[env] ?? env,
    );
  }

  if (next.condition) {
    try {
      const parsed = JSON.parse(next.condition);
      const remapped = remapConditionSavedGroups(parsed, mappings.savedGroups);
      next.condition = JSON.stringify(remapped);
    } catch {
      // Leave non-JSON conditions untouched.
    }
  }

  return next;
}

function remapConditionSavedGroups(
  node: unknown,
  mapping: Record<string, string>,
): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((item) => remapConditionSavedGroups(item, mapping));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (
      (key === "$inGroup" || key === "$notInGroup") &&
      typeof value === "string"
    ) {
      out[key] = mapping[value] ?? value;
    } else {
      out[key] = remapConditionSavedGroups(value, mapping);
    }
  }
  return out;
}

export function applyFeatureReferenceMappings(
  feature: GrowthBookFeatureClipboardFeature,
  mappings: FeatureReferenceMappings,
): GrowthBookFeatureClipboardFeature {
  const envMap = mappings.environments;
  const remappedEnvSettings = feature.environmentSettings
    ? Object.fromEntries(
        Object.entries(feature.environmentSettings).map(([env, settings]) => [
          envMap[env] ?? env,
          settings,
        ]),
      )
    : feature.environmentSettings;

  return {
    ...feature,
    environmentSettings: remappedEnvSettings,
    rules: feature.rules.map((rule) => applyMappingsToRule(rule, mappings)),
  };
}
