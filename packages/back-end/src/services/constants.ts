import { FeatureInterface } from "shared/types/feature";
import {
  getConstantReferenceKeys,
  getCyclicConstantRefs,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
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

// Reject a constant value (create or update) that would close a reference cycle.
// The runtime resolver leaves cyclic refs verbatim rather than crashing, but a
// stored cycle leaks raw `@const:` placeholders into the SDK payload, so we
// block it at write time (mirrors the picker's cyclic-key scrubbing).
export async function assertNoConstantCycle(
  context: ReqContext | ApiReqContext,
  key: string,
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): Promise<void> {
  const all = await context.models.constants.getAll();
  const cyclic = getCyclicConstantRefs(key, value, environmentValues, all);
  if (cyclic.length) {
    throw new BadRequestError(
      `This value references ${cyclic
        .map((k) => `@const:${k}`)
        .join(", ")}, which would create a reference cycle.`,
    );
  }
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
// values) and constant-to-constant references. Includes one level of constant
// chaining (parity with saved groups): a feature that reaches the target only
// through an intermediate constant (feature → `@const:mid` → `@const:target`) is
// still affected when the target is archived, so those features are surfaced
// too. Returns null if the constant doesn't exist.
export async function loadConstantReferences(
  context: ReqContext | ApiReqContext,
  constantId: string,
): Promise<ConstantReferences | null> {
  const allConstants = await context.models.constants.getAll();
  const target = allConstants.find((c) => c.id === constantId);
  if (!target) return null;

  // Other constants that directly embed the target (via `$extends` or `{{ }}`).
  const constantsReferencingTarget = allConstants.filter(
    (c) =>
      c.id !== constantId &&
      getConstantReferenceKeys(c.value, c.environmentValues).includes(
        target.key,
      ),
  );

  // Features are affected if they reference the target directly OR any constant
  // that embeds it (one level of chaining, matching loadSavedGroupReferences).
  const affectedKeys = new Set<string>([
    target.key,
    ...constantsReferencingTarget.map((c) => c.key),
  ]);

  const allFeatures = await context.models.features.getAll({});
  const features = allFeatures
    .filter((f) => {
      const keys = featureConstantKeys(f);
      for (const k of affectedKeys) {
        if (keys.has(k)) return true;
      }
      return false;
    })
    // Features have no display name distinct from their id; surface it as
    // `name` for parity with the saved-group references shape.
    .map((f) => ({ id: f.id, name: f.id, project: f.project || undefined }));

  const constants = constantsReferencingTarget.map((c) => ({
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

// Block archiving a constant that's still referenced (parity with saved groups).
// Keeps the invariant that archived constants have no live references, so a
// referenced constant can't silently drop config from feature payloads. The
// resolver still scrubs archived refs as a backend safety net (e.g. for
// cross-project references the archiver can't see). Only the archive transition
// is gated — unarchiving is always allowed. `constantId` is the internal id.
export async function assertConstantArchivable(
  context: ReqContext | ApiReqContext,
  constantId: string,
): Promise<void> {
  const refs = await loadConstantReferences(context, constantId);
  if (!refs || totalConstantReferences(refs) === 0) return;
  const parts: string[] = [];
  if (refs.features.length) parts.push(`${refs.features.length} feature(s)`);
  if (refs.constants.length) {
    parts.push(`${refs.constants.length} other constant(s)`);
  }
  throw new BadRequestError(
    `Cannot archive constant: it is still referenced by ${parts.join(
      ", ",
    )}. Remove these references first.`,
  );
}
