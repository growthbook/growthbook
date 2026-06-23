import { FeatureInterface } from "shared/types/feature";
import { getConstantReferenceKeys } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

// Constants are resolved into SDK payloads at build time (`@const:` references).
// Changing a value therefore changes the generated payload, so we refresh the
// SDK payload cache (which also fires SDK webhooks for affected connections).
//
// Constants can be referenced cross-project and across environments, so — like
// saved groups — we conservatively refresh every cache entry across all
// environments/projects rather than trying to scope to the constant.
// TODO: scope to the constant's actual references once reference tracking lands.
export async function constantUpdated(
  baseContext: ReqContext | ApiReqContext,
  event: "updated" | "deleted" = "updated",
) {
  // Background job: use a context with full read permissions.
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  queueSDKPayloadRefresh({
    context,
    payloadKeys: getPayloadKeysForAllEnvs(context, [""]),
    treatEmptyProjectAsGlobal: true,
    auditContext: {
      event,
      model: "constant",
    },
  });
}

export type ConstantReferences = {
  features: { id: string; name: string; project?: string }[];
  constants: { id: string; key: string; name: string; project?: string }[];
};

// A rule member that may carry a feature value (force/rollout `value`, or
// experiment `variations[].value`). Other rule fields don't hold values.
type ValueBearingRule = {
  value?: unknown;
  variations?: Array<{ value?: unknown }>;
};

// Every value string a feature can hold: the default plus each rule's force/
// rollout value and each experiment variation value, from both the v2 `rules`
// array and the legacy per-environment `environmentSettings[env].rules`.
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

// Features and other constants that reference a given constant via `@const:key`.
// Scope mirrors resolution: feature values (flags + feature-experiment variation
// values) and constant-to-constant references. Returns null if the constant
// doesn't exist.
export async function loadConstantReferences(
  context: ReqContext | ApiReqContext,
  constantId: string,
): Promise<ConstantReferences | null> {
  const allConstants = await context.models.constants.getAll();
  const target = allConstants.find((c) => c.id === constantId);
  if (!target) return null;

  const allFeatures = await getAllFeatures(context, {});
  const features = allFeatures
    .filter((f) => featureConstantKeys(f).has(target.key))
    // Features have no display name distinct from their id; surface it as
    // `name` for parity with the saved-group references shape.
    .map((f) => ({ id: f.id, name: f.id, project: f.project || undefined }));

  const constants = allConstants
    .filter(
      (c) =>
        c.id !== constantId &&
        getConstantReferenceKeys(c.value, c.environmentValues).includes(
          target.key,
        ),
    )
    .map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      project: c.project || undefined,
    }));

  return { features, constants };
}

export function totalConstantReferences(refs: ConstantReferences): number {
  return refs.features.length + refs.constants.length;
}
