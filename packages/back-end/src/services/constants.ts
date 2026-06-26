import { FeatureInterface } from "shared/types/feature";
import { ConfigInterface } from "shared/types/config";
import {
  getConstantReferenceKeys,
  getCyclicConstantRefs,
} from "shared/validators";
import {
  getConfigParentKey,
  getConfigSubtree,
  getConfigBackingKey,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getResolvableValues } from "./resolvableValues";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

// A constant/config change alters the SDK payload, so refresh it (and fire SDK
// webhooks). Refs cross project/env, so we refresh everything for now.
// TODO: scope to the actual references once reference tracking lands.
export async function resolvableValueChanged(
  baseContext: ReqContext | ApiReqContext,
  event: "updated" | "deleted" = "updated",
  model: "constant" | "config" = "constant",
) {
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  queueSDKPayloadRefresh({
    context,
    payloadKeys: getPayloadKeysForAllEnvs(context, [""]),
    treatEmptyProjectAsGlobal: true,
    auditContext: {
      event,
      model,
    },
  });
}

// Reject cyclic values at write time — a stored cycle leaks raw `@const:`
// placeholders into the payload.
export async function assertNoReferenceCycle(
  context: ReqContext | ApiReqContext,
  key: string,
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): Promise<void> {
  const all = await getResolvableValues(context);
  const cyclic = getCyclicConstantRefs(key, value, environmentValues, all);
  if (cyclic.length) {
    throw new BadRequestError(
      `This value references ${cyclic
        .map((k) => `@const:${k}`)
        .join(", ")}, which would create a reference cycle.`,
    );
  }
}

// Keys are unique across both collections — check each. Returns the owner, or null.
export async function findKeyOwnerAcrossNamespace(
  context: ReqContext | ApiReqContext,
  key: string,
): Promise<"constant" | "config" | null> {
  const [constant, config] = await Promise.all([
    context.models.constants.getByKey(key),
    context.models.configs.getByKey(key),
  ]);
  if (constant) return "constant";
  if (config) return "config";
  return null;
}

// Throw a friendly duplicate-key error if `key` is taken by a constant or config.
export async function assertKeyAvailableAcrossNamespace(
  context: ReqContext | ApiReqContext,
  key: string,
): Promise<void> {
  const owner = await findKeyOwnerAcrossNamespace(context, key);
  if (owner) {
    throw new BadRequestError(
      `A ${owner} with key "${key}" already exists. Keys must be unique across constants and configs.`,
    );
  }
}

export type ConstantReferences = {
  features: { id: string; name: string; project?: string }[];
  // `isConfig` lets the UI link to the right detail page.
  constants: {
    id: string;
    key: string;
    name: string;
    project?: string;
    isConfig?: boolean;
  }[];
};

type ValueBearingRule = {
  value?: unknown;
  variations?: Array<{ value?: unknown }>;
};

// Every rule/variation value string a feature holds, from both the v2 `rules`
// array and the legacy per-environment `environmentSettings[env].rules`.
function featureRuleValueStrings(feature: FeatureInterface): string[] {
  const out: string[] = [];
  const collect = (rule: ValueBearingRule) => {
    if (typeof rule.value === "string") out.push(rule.value);
    for (const v of rule.variations ?? []) {
      if (typeof v.value === "string") out.push(v.value);
    }
  };

  for (const rule of (feature.rules ?? []) as ValueBearingRule[]) collect(rule);
  const envSettings = (feature.environmentSettings ?? {}) as Record<
    string,
    { rules?: ValueBearingRule[] }
  >;
  for (const env of Object.values(envSettings)) {
    for (const rule of env?.rules ?? []) collect(rule);
  }
  return out;
}

// Every value string a feature can hold (default value + all rule values).
function featureValueStrings(feature: FeatureInterface): string[] {
  const out: string[] = [];
  if (typeof feature.defaultValue === "string") out.push(feature.defaultValue);
  out.push(...featureRuleValueStrings(feature));
  return out;
}

// The set of constant keys referenced anywhere in a feature's values.
function featureConstantKeys(feature: FeatureInterface): Set<string> {
  const keys = new Set<string>();
  for (const value of featureValueStrings(feature)) {
    for (const key of getConstantReferenceKeys(value, undefined)) keys.add(key);
  }
  return keys;
}

// Features and constants/configs that reference a constant. Includes one level
// of constant chaining (feature → @const:mid → @const:target), matching saved
// groups. Returns null if the constant doesn't exist.
export async function loadConstantReferences(
  context: ReqContext | ApiReqContext,
  constantId: string,
): Promise<ConstantReferences | null> {
  // Span both collections — references cross the config/constant boundary.
  const configs = await context.models.configs.getAll();
  const configIds = new Set(configs.map((c) => c.id));
  const allConstants = await getResolvableValues(context);
  const target = allConstants.find((c) => c.id === constantId);
  if (!target) return null;

  // Constants/configs that directly embed the target.
  const constantsReferencingTarget = allConstants.filter(
    (c) =>
      c.id !== constantId &&
      getConstantReferenceKeys(c.value, c.environmentValues).includes(
        target.key,
      ),
  );

  // Affected = references the target directly or via one embedding constant.
  const affectedKeys = new Set<string>([
    target.key,
    ...constantsReferencingTarget.map((c) => c.key),
  ]);

  const allFeatures = await getAllFeatures(context, {});
  const features = allFeatures
    .filter((f) => {
      const keys = featureConstantKeys(f);
      for (const k of affectedKeys) {
        if (keys.has(k)) return true;
      }
      return false;
    })
    // Features have no name distinct from id; surface id as `name`.
    .map((f) => ({ id: f.id, name: f.id, project: f.project || undefined }));

  const constants = constantsReferencingTarget.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    project: c.project || undefined,
    isConfig: configIds.has(c.id) || undefined,
  }));

  return { features, constants };
}

export function totalConstantReferences(refs: ConstantReferences): number {
  return refs.features.length + refs.constants.length;
}

export type ConfigFamilyFeatureRef = {
  id: string;
  name: string;
  project?: string;
  // The config backing the feature's default value (in this family), if any.
  defaultConfigKey: string | null;
  // Configs used by rules that differ from the default config — the inverted
  // tree only surfaces rule overrides that change which config is served.
  ruleConfigKeys: string[];
};

// Features that reference any config in the lineage family of `configId` — the
// config, its ancestors, and all descendants. Each result splits the default
// config from the (differing) rule configs so the UI can render an inverted
// tree: feature → default config, then rules → rule configs.
export async function loadConfigFamilyFeatureReferences(
  context: ReqContext | ApiReqContext,
  configId: string,
): Promise<{
  familyKeys: string[];
  features: ConfigFamilyFeatureRef[];
} | null> {
  const config = await context.models.configs.getById(configId);
  if (!config) return null;

  const allConfigs = await context.models.configs.getAll();
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));

  // Walk to the lineage root, then take its whole subtree as the family.
  let rootKey = config.key;
  const seen = new Set<string>();
  let cur: typeof config | undefined = config;
  while (cur && !seen.has(cur.key)) {
    seen.add(cur.key);
    rootKey = cur.key;
    const parentKey = getConfigParentKey(cur);
    cur = parentKey ? byKey.get(parentKey) : undefined;
  }
  const familyKeys = getConfigSubtree(rootKey, allConfigs);
  const familySet = new Set(familyKeys);

  const allFeatures = await getAllFeatures(context, {});
  const features: ConfigFamilyFeatureRef[] = [];
  for (const f of allFeatures) {
    const rawDefaultKey =
      typeof f.defaultValue === "string"
        ? getConfigBackingKey(f.defaultValue)
        : null;
    const defaultConfigKey =
      rawDefaultKey && familySet.has(rawDefaultKey) ? rawDefaultKey : null;

    const ruleKeys = new Set<string>();
    for (const value of featureRuleValueStrings(f)) {
      const key = getConfigBackingKey(value);
      if (key && familySet.has(key) && key !== defaultConfigKey) {
        ruleKeys.add(key);
      }
    }

    if (!defaultConfigKey && ruleKeys.size === 0) continue;
    features.push({
      id: f.id,
      name: f.id,
      project: f.project || undefined,
      defaultConfigKey,
      ruleConfigKeys: [...ruleKeys],
    });
  }
  return { familyKeys, features };
}

// Block archiving a still-referenced constant; unarchiving is always allowed.
export async function assertConstantArchivable(
  context: ReqContext | ApiReqContext,
  constantId: string,
  noun: "constant" | "config" = "constant",
): Promise<void> {
  const refs = await loadConstantReferences(context, constantId);
  if (!refs || totalConstantReferences(refs) === 0) return;
  const parts: string[] = [];
  if (refs.features.length) parts.push(`${refs.features.length} feature(s)`);
  if (refs.constants.length) {
    parts.push(`${refs.constants.length} other constant(s)/config(s)`);
  }
  throw new BadRequestError(
    `Cannot archive ${noun}: it is still referenced by ${parts.join(
      ", ",
    )}. Remove these references first.`,
  );
}

// Configs whose lineage parent is `configKey`. Uses the unfiltered set so a
// child in an unreadable project still blocks the guard (lineage is global).
async function getChildConfigs(
  context: ReqContext | ApiReqContext,
  configKey: string,
): Promise<ConfigInterface[]> {
  const all = await context.models.configs.getAllForReconcile();
  return all.filter(
    (c) => c.key !== configKey && getConfigParentKey(c) === configKey,
  );
}

// Block archiving a config that is still referenced (value-embedded refs) OR
// that has live child configs inheriting from it — archiving the base would
// break the children's resolution. Unarchiving is always allowed.
export async function assertConfigArchivable(
  context: ReqContext | ApiReqContext,
  config: { id: string; key: string },
): Promise<void> {
  await assertConstantArchivable(context, config.id, "config");

  const liveChildren = (await getChildConfigs(context, config.key)).filter(
    (c) => !c.archived,
  );
  if (liveChildren.length) {
    throw new BadRequestError(
      `Cannot archive config: ${liveChildren.length} live child config(s) inherit from it (${liveChildren
        .map((c) => c.key)
        .join(", ")}). Archive or re-parent them first.`,
    );
  }
}

// Block deleting a config that any other config still inherits from (archived
// or not) — deletion would dangle their `parent` pointer.
export async function assertConfigDeletable(
  context: ReqContext | ApiReqContext,
  config: { id: string; key: string },
): Promise<void> {
  const children = await getChildConfigs(context, config.key);
  if (children.length) {
    throw new BadRequestError(
      `Cannot delete config: ${children.length} child config(s) inherit from it (${children
        .map((c) => c.key)
        .join(", ")}). Delete or re-parent them first.`,
    );
  }
}
