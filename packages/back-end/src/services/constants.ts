import { FeatureInterface } from "shared/types/feature";
import {
  getConstantReferenceKeys,
  getCyclicConstantRefs,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getResolvableConstants } from "./resolvableConstants";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

// A value change alters the generated SDK payload, so refresh the payload cache
// (and fire SDK webhooks). Constants reference cross-project/env, so — like saved
// groups — we conservatively refresh everything rather than scope to the constant.
// TODO: scope to the constant's actual references once reference tracking lands.
export async function constantUpdated(
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

// A stored cycle leaks raw `@const:` placeholders into the payload (the resolver
// degrades gracefully but doesn't fix it), so reject cyclic values at write time.
export async function assertNoConstantCycle(
  context: ReqContext | ApiReqContext,
  key: string,
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): Promise<void> {
  const all = await getResolvableConstants(context);
  const cyclic = getCyclicConstantRefs(key, value, environmentValues, all);
  if (cyclic.length) {
    throw new BadRequestError(
      `This value references ${cyclic
        .map((k) => `@const:${k}`)
        .join(", ")}, which would create a reference cycle.`,
    );
  }
}

// Constants and configs share the `@const:` namespace across separate
// collections, so check both for a key collision. Returns the owner, or null.
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

// Every value string a feature can hold, from both the v2 `rules` array and the
// legacy per-environment `environmentSettings[env].rules`.
function featureValueStrings(feature: FeatureInterface): string[] {
  const out: string[] = [];
  if (typeof feature.defaultValue === "string") out.push(feature.defaultValue);

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
  const allConstants = await getResolvableConstants(context);
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
