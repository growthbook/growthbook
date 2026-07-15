import isEqual from "lodash/isEqual";
import { FeatureInterface } from "shared/types/feature";
import { ConfigInterface } from "shared/types/config";
import {
  getConstantReferenceKeys,
  getCyclicConstantRefs,
} from "shared/validators";
import {
  getConfigParentKey,
  getConfigSubtree,
  getConfigAncestorKeys,
  getConfigBackingKey,
  getFeatureBaseConfigKey,
  parsePlainJSONObject,
  findScopedOverrideStructuralErrors,
  ScopedOverrideEntry,
  constantRequiresReview,
} from "shared/util";
import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import { ConstantSource } from "shared/sdk-versioning";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError, SoftWarningError } from "back-end/src/util/errors";
import {
  getPayloadKeysForAllEnvs,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { getResolvableValues, ResolvableValue } from "./resolvableValues";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

// A constant/config change alters the SDK payload, so refresh it (and fire SDK
// webhooks). When we know which resolvable changed (`changedKey`), we scope the
// refresh to only the connections serving features that actually depend on it —
// directly, or transitively through other constants/configs (constant `@const:`
// chains and config lineage, both surfaced as tokens by `getResolvableValues`).
// When nothing references it, the refresh is skipped entirely. Without a key we
// fall back to the org-wide refresh (matches the historical behavior).
//
// Saved groups deliberately keep the org-wide refresh (`savedGroupUpdated`):
// their reference graph is condition-string based, recursively nested, and spans
// experiments as well as features, so it doesn't share this token machinery.
export async function resolvableValueChanged(
  baseContext: ReqContext | ApiReqContext,
  event: "updated" | "deleted" = "updated",
  model: "constant" | "config" = "constant",
  changedKey?: string,
) {
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  if (changedKey) {
    const features = await getFeaturesAffectedByResolvable(
      context,
      model,
      changedKey,
    );
    const payloadKeys = getAffectedSDKPayloadKeys(
      features,
      getEnvironmentIdsFromOrg(context.org),
    );
    // No feature depends on this value — nothing to rebuild or notify.
    if (!payloadKeys.length) return;
    queueSDKPayloadRefresh({
      context,
      payloadKeys,
      auditContext: {
        event,
        model,
      },
    });
    return;
  }

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

type ResolvableRef = { source: ConstantSource; key: string };

// The full set of namespaced tokens that transitively embed `(source, key)`,
// including the seed itself. Edges come from resolvable→resolvable references and
// unify two mechanisms: constant `@const:` chains and config lineage —
// `getResolvableValues` synthesizes a config's `parent`/`extends` bases into
// `@config:` `$extends` tokens on its value, so both are extracted identically.
// We walk the graph in reverse (everything that transitively embeds the seed
// would re-resolve when it changes). Pure + exported for unit testing.
export function resolvableDependencyClosure(
  resolvables: ResolvableValue[],
  source: ConstantSource,
  key: string,
): Set<string> {
  // Reverse edges: token -> resolvables that directly reference that token.
  const referencedBy = new Map<string, ResolvableRef[]>();
  const addEdge = (token: string, r: ResolvableValue) => {
    const ref: ResolvableRef = { source: r.source, key: r.key };
    const list = referencedBy.get(token);
    if (list) list.push(ref);
    else referencedBy.set(token, [ref]);
  };
  for (const r of resolvables) {
    for (const ns of ["constant", "config"] as const) {
      for (const refKey of getConstantReferenceKeys(
        r.value,
        r.environmentValues,
        ns,
      )) {
        addEdge(refToken(ns, refKey), r);
      }
    }
    // A config references its scope-selected flavor configs via `scopedOverrides`
    // (not a `@config:` `$extends` ref), so add those edges explicitly — a flavor
    // change must propagate to the parent, and thence to features that use it.
    for (const entry of r.scopedOverrides ?? []) {
      addEdge(refToken("config", entry.config), r);
    }
  }

  const seed = refToken(source, key);
  const affected = new Set<string>([seed]);
  const queue = [seed];
  while (queue.length) {
    const token = queue.shift() as string;
    for (const dep of referencedBy.get(token) ?? []) {
      const depToken = refToken(dep.source, dep.key);
      if (!affected.has(depToken)) {
        affected.add(depToken);
        queue.push(depToken);
      }
    }
  }
  return affected;
}

// Every feature whose resolved SDK payload depends on the given resolvable
// (constant or config), directly or transitively. Pure + exported for unit
// testing; `getFeaturesAffectedByResolvable` adds the data loading.
//
// On delete the changed entity is already gone from `resolvables`, but features
// referencing it directly are still matched (their refs now dangle), and delete
// is blocked while other resolvables depend on it, so the closure stays correct.
export function featuresAffectedByResolvable(
  resolvables: ResolvableValue[],
  features: FeatureInterface[],
  source: ConstantSource,
  key: string,
): FeatureInterface[] {
  const affected = resolvableDependencyClosure(resolvables, source, key);
  return features.filter((f) => {
    // A feature usually holds only a handful of reference tokens, so probe those
    // against the (possibly large) affected set rather than the other way round.
    for (const t of featureReferenceTokens(f)) {
      if (affected.has(t)) return true;
    }
    return false;
  });
}

async function getFeaturesAffectedByResolvable(
  context: ReqContext | ApiReqContext,
  source: ConstantSource,
  key: string,
): Promise<FeatureInterface[]> {
  const [resolvables, features] = await Promise.all([
    getResolvableValues(context),
    getAllFeatures(context, {}),
  ]);
  return featuresAffectedByResolvable(resolvables, features, source, key);
}

// Reject cyclic values at write time — a stored cycle leaks raw reference
// placeholders into the payload. `namespace` scopes the check: cycles are always
// intra-namespace (constants reference only constants; configs reference only
// configs in their lineage), so a constant and a config sharing a bare key are
// never conflated.
export async function assertNoReferenceCycle(
  context: ReqContext | ApiReqContext,
  key: string,
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
  namespace: ConstantSource = "constant",
): Promise<void> {
  const all = (await getResolvableValues(context)).filter(
    (c) => c.source === namespace,
  );
  const cyclic = getCyclicConstantRefs(
    key,
    value,
    environmentValues,
    all,
    namespace,
  );
  if (cyclic.length) {
    const prefix = namespace === "config" ? "@config:" : "@const:";
    throw new BadRequestError(
      `This value references ${cyclic
        .map((k) => `${prefix}${k}`)
        .join(", ")}, which would create a reference cycle.`,
    );
  }
}

// Throw a friendly duplicate-key error if `key` is already taken within the
// given namespace. Constants and configs are independent namespaces (a constant
// and a config MAY share a key — `@const:foo` and `@config:foo` are distinct),
// so each collection is checked on its own. The DB also enforces a per-org
// unique index per collection; this just yields a nicer message.
export async function assertKeyAvailable(
  context: ReqContext | ApiReqContext,
  key: string,
  namespace: ConstantSource,
): Promise<void> {
  const existing =
    namespace === "config"
      ? await context.models.configs.getByKey(key)
      : await context.models.constants.getByKey(key);
  if (existing) {
    throw new BadRequestError(
      `A ${namespace} with key "${key}" already exists.`,
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

// Structurally spans every value-bearing field across the FeatureRule union.
type ValueBearingRule = {
  value?: unknown;
  variations?: Array<{ value?: unknown }>;
  values?: Array<{ value?: unknown }>;
  controlValue?: unknown;
  variationValue?: unknown;
};

// Every rule/variation value string a feature holds, from both the v2 `rules`
// array and the legacy per-environment `environmentSettings[env].rules`.
function featureRuleValueStrings(feature: FeatureInterface): string[] {
  const out: string[] = [];
  const collect = (rule: ValueBearingRule) => {
    if (typeof rule.value === "string") out.push(rule.value);
    for (const v of [...(rule.variations ?? []), ...(rule.values ?? [])]) {
      if (typeof v.value === "string") out.push(v.value);
    }
    if (typeof rule.controlValue === "string") out.push(rule.controlValue);
    if (typeof rule.variationValue === "string") out.push(rule.variationValue);
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

// Every value string a feature can hold (default value + all rule values). The
// holdout value is included because the payload builder injects it as a `force`
// rule (`getFeatureDefinition`) that the constant resolver then processes, so a
// reference there is a real payload dependency just like any other rule value.
function featureValueStrings(feature: FeatureInterface): string[] {
  const out: string[] = [];
  if (typeof feature.defaultValue === "string") out.push(feature.defaultValue);
  out.push(...featureRuleValueStrings(feature));
  if (typeof feature.holdout?.value === "string") {
    out.push(feature.holdout.value);
  }
  return out;
}

// A namespaced reference token (`constant:key` / `config:key`) used to match
// references without conflating a key shared by a constant and a config.
const refToken = (source: ConstantSource, key: string): string =>
  `${source}:${key}`;

// The set of namespaced reference tokens a feature's values hold (both
// `@const:` and `@config:` references). Exported for unit testing.
export function featureReferenceTokens(feature: FeatureInterface): Set<string> {
  const tokens = new Set<string>();
  // A config-backed feature whose values are pure patches (the common create
  // path: default = the base config with no override) carries the backing on
  // `feature.baseConfig`, not as a `@config:` token in any value string. Emit it
  // explicitly so editing/deleting/archiving that config still matches the
  // feature (matches loadConfigFamilyFeatureReferences).
  const baseConfigKey = getFeatureBaseConfigKey(feature);
  if (baseConfigKey) tokens.add(refToken("config", baseConfigKey));
  for (const value of featureValueStrings(feature)) {
    for (const key of getConstantReferenceKeys(value, undefined, "constant")) {
      tokens.add(refToken("constant", key));
    }
    for (const key of getConstantReferenceKeys(value, undefined, "config")) {
      tokens.add(refToken("config", key));
    }
  }
  return tokens;
}

// Pure: the experiment / contextual-bandit ids whose experiment-ref (or
// contextual-bandit-ref) rule interpolates `@const:<key>` DIRECTLY in an arm
// value — i.e. NOT through a config. The resolvable graph has only constant and
// config nodes, so a feature's direct `@const:` reference is invisible to
// `resolvableDependencyClosure`; this scans features per-rule to close that gap.
// Exported for unit testing; the I/O wrapper below adds loading + running-status.
export function experimentRefsReferencingConstant(
  features: FeatureInterface[],
  constantKey: string,
): { experimentIds: string[]; banditIds: string[] } {
  const experimentIds = new Set<string>();
  const banditIds = new Set<string>();

  const referencesConstant = (rule: ImplementingRule): boolean => {
    const values: unknown[] = [
      rule.value,
      rule.controlValue,
      rule.variationValue,
      ...(rule.variations ?? []).map((v) => v.value),
      ...(rule.values ?? []).map((v) => v.value),
    ];
    return values.some(
      (v) =>
        typeof v === "string" &&
        getConstantReferenceKeys(v, undefined, "constant").includes(
          constantKey,
        ),
    );
  };

  const scan = (rule: ImplementingRule) => {
    if (rule.type === "experiment-ref") {
      if (rule.experimentId && referencesConstant(rule)) {
        experimentIds.add(rule.experimentId);
      }
    } else if (rule.type === "contextual-bandit-ref") {
      if (rule.contextualBanditId && referencesConstant(rule)) {
        banditIds.add(rule.contextualBanditId);
      }
    }
  };

  for (const feature of features) {
    for (const rule of (feature.rules ?? []) as ImplementingRule[]) scan(rule);
    const envSettings = (feature.environmentSettings ?? {}) as Record<
      string,
      { rules?: ImplementingRule[] }
    >;
    for (const env of Object.values(envSettings)) {
      for (const rule of env?.rules ?? []) scan(rule);
    }
  }

  return { experimentIds: [...experimentIds], banditIds: [...banditIds] };
}

// Running experiments / contextual bandits whose rule directly references the
// constant. Returns `exp:<id>` tokens so they never collide with config-key
// conflicts in the shared experiment-guard fingerprint. Caller supplies an
// org-wide context so a running experiment in any project is seen.
export async function findRunningExperimentRefsReferencingConstant(
  context: ReqContext | ApiReqContext,
  constantKey: string,
): Promise<Set<string>> {
  const features = await getAllFeatures(context, {});
  const { experimentIds, banditIds } = experimentRefsReferencingConstant(
    features,
    constantKey,
  );
  if (!experimentIds.length && !banditIds.length) return new Set<string>();

  const conflicts = new Set<string>();
  const collectRunning = (entities: Array<{ id: string; status: string }>) => {
    for (const e of entities) {
      if (e.status === "running") conflicts.add(`exp:${e.id}`);
    }
  };
  if (experimentIds.length) {
    collectRunning(await getExperimentsByIds(context, experimentIds));
  }
  if (banditIds.length) {
    collectRunning(await context.models.contextualBandits.getByIds(banditIds));
  }
  return conflicts;
}

// Features and constants/configs that reference a constant. Includes one level
// of constant chaining (feature → @const:mid → @const:target), matching saved
// groups. Returns null if the constant doesn't exist.
export async function loadConstantReferences(
  context: ReqContext | ApiReqContext,
  constantId: string,
): Promise<ConstantReferences | null> {
  // Span both collections — a constant target may be referenced by configs (via
  // `@const:`) and vice versa. Matching is namespaced: a reference to the target
  // only counts when its `@const:`/`@config:` prefix matches the target's own
  // namespace, so a same-keyed constant/config pair isn't conflated.
  const allConstants = await getResolvableValues(context);
  const target = allConstants.find((c) => c.id === constantId);
  if (!target) return null;

  // Constants/configs that directly embed the target (in the target's namespace).
  const constantsReferencingTarget = allConstants.filter(
    (c) =>
      c.id !== constantId &&
      getConstantReferenceKeys(
        c.value,
        c.environmentValues,
        target.source,
      ).includes(target.key),
  );

  // Affected = references the target directly or via one embedding resolvable.
  // Tracked as namespaced tokens so feature matching stays namespace-correct.
  const affectedTokens = new Set<string>([
    refToken(target.source, target.key),
    ...constantsReferencingTarget.map((c) => refToken(c.source, c.key)),
  ]);

  const allFeatures = await getAllFeatures(context, {});
  const features = allFeatures
    .filter((f) => {
      const tokens = featureReferenceTokens(f);
      for (const t of affectedTokens) {
        if (tokens.has(t)) return true;
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
    isConfig: c.source === "config" || undefined,
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

// The lineage family of a config: the parent-spine root's whole subtree — the
// config, its parent-spine ancestors, and all descendants (following parent +
// extends). Null if the config doesn't exist. Returns the loaded configs so
// callers can reason about lineage without re-querying.
async function resolveConfigFamily(
  context: ReqContext | ApiReqContext,
  configId: string,
): Promise<{
  config: ConfigInterface;
  allConfigs: ConfigInterface[];
  byKey: Map<string, ConfigInterface>;
  familyKeys: string[];
} | null> {
  // Lineage is global and can span projects the caller can't read, so load the
  // unfiltered set (matching getConfigResolved / getDependentConfigs) — a
  // read-filtered list would truncate the family and drop usage rows.
  const allConfigs = await context.models.configs.getAllForReconcile();
  const config = allConfigs.find((c) => c.id === configId);
  if (!config) return null;

  const byKey = new Map(allConfigs.map((c) => [c.key, c]));

  let rootKey = config.key;
  const seen = new Set<string>();
  let cur: typeof config | undefined = config;
  while (cur && !seen.has(cur.key)) {
    seen.add(cur.key);
    rootKey = cur.key;
    const parentKey = getConfigParentKey(cur);
    cur = parentKey ? byKey.get(parentKey) : undefined;
  }
  return {
    config,
    allConfigs,
    byKey,
    familyKeys: getConfigSubtree(rootKey, allConfigs),
  };
}

// Features that reference any config in the lineage family of `configId`. Each
// result splits the default config from the (differing) rule configs so the UI
// can render an inverted tree: feature → default config, then rules → rule configs.
export async function loadConfigFamilyFeatureReferences(
  context: ReqContext | ApiReqContext,
  configId: string,
): Promise<{
  familyKeys: string[];
  features: ConfigFamilyFeatureRef[];
} | null> {
  const resolved = await resolveConfigFamily(context, configId);
  if (!resolved) return null;
  const { familyKeys } = resolved;
  const familySet = new Set(familyKeys);

  const allFeatures = await getAllFeatures(context, {});
  const features: ConfigFamilyFeatureRef[] = [];
  for (const f of allFeatures) {
    const rawDefaultKey = getFeatureBaseConfigKey(f);
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

// One place a config-backed value implements the config: a feature's default
// value or a single rule/variation. `configKey` is the family config the value
// extends; `keys` are the config fields the value overrides in its own patch.
// `state` distinguishes a published linkage from one that only exists in an open
// feature draft revision (`revisionVersion`). Experiment refs carry the linked
// experiment's name and status; contextual-bandit refs carry `contextualBanditId`
// and reuse the same `experimentName`/`experimentStatus` fields (the bandit's
// status shares the experiment vocabulary: draft | running | stopped).
export type ConfigKeyImplementation = {
  featureId: string;
  project?: string;
  location: "defaultValue" | "rule";
  ruleType?: string;
  ruleId?: string;
  experimentId?: string;
  // Set instead of `experimentId` for a `contextual-bandit-ref` rule; used to
  // link to the contextual bandit and to resolve its name/status.
  contextualBanditId?: string;
  experimentName?: string;
  experimentStatus?: string;
  variationId?: string;
  configKey: string;
  // The backing config's relationship to the config being viewed.
  relation?: "self" | "ancestor" | "descendant" | "other";
  keys: string[];
  // The raw override values this slot sets, keyed by config field (the value's
  // patch, minus the `$extends` directive). One entry per variation for
  // experiment/bandit refs. Used to show "what this overrides it to".
  patch?: Record<string, unknown>;
  state: "live" | "draft";
  revisionVersion?: number;
};

type ImplementingRule = {
  type?: string;
  id?: string;
  experimentId?: string;
  contextualBanditId?: string;
  value?: unknown;
  variations?: Array<{ variationId?: string; value?: unknown }>;
  values?: Array<{ variationId?: string; value?: unknown }>;
  controlValue?: unknown;
  variationValue?: unknown;
};

// A feature's values in one state: its published form ("live") or an open draft
// revision ("draft"). `rules` is the flat rule list (all environments merged).
export type FeatureValueSource = {
  featureId: string;
  project?: string;
  state: "live" | "draft";
  revisionVersion?: number;
  defaultValue?: unknown;
  rules: ImplementingRule[];
};

// The config fields a stored value overrides, as raw key→value pairs: the value
// minus the `$extends` slot (which only carries reference tokens, not field
// data). `keys` on the implementation are just `Object.keys` of this.
function overriddenConfigPatch(value: string): Record<string, unknown> {
  const obj = parsePlainJSONObject(value);
  if (!obj) return {};
  const rest = { ...obj };
  delete rest[CONSTANT_EXTENDS_KEY];
  return rest;
}

// Every config-backed value slot across the sources whose backing config is in
// `familySet`, with the metadata to trace each back to where it's implemented.
// Live wins: a draft slot is dropped when the identical slot is already live
// (drafts snapshot every rule, so unchanged ones would otherwise duplicate).
// Per-source, per-environment duplicates collapse, unioning overridden keys.
export function computeConfigKeyImplementations(
  sources: FeatureValueSource[],
  familySet: Set<string>,
): ConfigKeyImplementation[] {
  const liveSignatures = new Set<string>();
  const bySignature = new Map<string, ConfigKeyImplementation>();

  const addSlot = (
    source: FeatureValueSource,
    value: unknown,
    location: ConfigKeyImplementation["location"],
    meta: Pick<
      ConfigKeyImplementation,
      | "ruleType"
      | "ruleId"
      | "experimentId"
      | "contextualBanditId"
      | "variationId"
    >,
  ) => {
    if (typeof value !== "string") return;
    const configKey = getConfigBackingKey(value);
    if (!configKey || !familySet.has(configKey)) return;

    const signature = [
      source.featureId,
      location,
      meta.ruleId ?? "",
      meta.variationId ?? "",
      configKey,
    ].join("|");
    if (source.state === "live") liveSignatures.add(signature);
    else if (liveSignatures.has(signature)) return;

    const patch = overriddenConfigPatch(value);
    const keys = Object.keys(patch);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.keys = [...new Set([...existing.keys, ...keys])];
      existing.patch = { ...existing.patch, ...patch };
      return;
    }
    bySignature.set(signature, {
      featureId: source.featureId,
      project: source.project,
      location,
      configKey,
      keys,
      patch,
      state: source.state,
      revisionVersion: source.revisionVersion,
      ...meta,
    });
  };

  const collect = (source: FeatureValueSource) => {
    addSlot(source, source.defaultValue, "defaultValue", {});
    for (const rule of source.rules) {
      const base = {
        ruleType: rule.type,
        ruleId: rule.id,
        experimentId: rule.experimentId,
        contextualBanditId: rule.contextualBanditId,
      };
      addSlot(source, rule.value, "rule", base);
      // Fall back to the arm index for the signature: inline `experiment` rule
      // values carry no `variationId`, so without this each arm collapses into a
      // single slot (last value wins) instead of one slot per variation.
      for (const [i, v] of (rule.variations ?? []).entries()) {
        addSlot(source, v.value, "rule", {
          ...base,
          variationId: v.variationId ?? `v${i}`,
        });
      }
      for (const [i, v] of (rule.values ?? []).entries()) {
        addSlot(source, v.value, "rule", {
          ...base,
          variationId: v.variationId ?? `v${i}`,
        });
      }
      addSlot(source, rule.controlValue, "rule", {
        ...base,
        variationId: "control",
      });
      addSlot(source, rule.variationValue, "rule", {
        ...base,
        variationId: "variation",
      });
    }
  };

  // Live first, so every live signature is known before drafts are filtered.
  for (const s of sources) if (s.state === "live") collect(s);
  for (const s of sources) if (s.state === "draft") collect(s);

  return [...bySignature.values()];
}

// Which feature rules and default values implement each key of a config's
// lineage family — for the config-detail "Usage" surface. Spans published
// features and open feature drafts, and resolves the linked experiment's name +
// status for experiment-ref rules. Null if the config doesn't exist.
export async function getConfigKeyImplementations(
  context: ReqContext | ApiReqContext,
  configId: string,
): Promise<{
  familyKeys: string[];
  implementations: ConfigKeyImplementation[];
} | null> {
  // These three reads are independent — run them concurrently.
  const [resolved, allFeatures, drafts] = await Promise.all([
    resolveConfigFamily(context, configId),
    getAllFeatures(context, {}),
    getRevisionsByStatus(context, [
      "draft",
      "pending-review",
      "changes-requested",
      "approved",
    ]),
  ]);
  if (!resolved) return null;
  const { config, allConfigs, byKey, familyKeys } = resolved;

  // The family spans the whole lineage (including `extends`), so a config that
  // mixes this one in still surfaces when it overrides one of this config's
  // keys. The front-end scopes the displayed keys to this config's own fieldset
  // so unrelated keys from those consumers aren't pulled in.
  const familySet = new Set(familyKeys);

  // Classify each backing config relative to the config being viewed. This feeds
  // the API `relation` field (REST consumers); the UI's "Config source" column
  // just shows the config name, since the direction is ambiguous for mixins.
  // Configs inherit via `$extends` (base-wins, children override the base's
  // values), so anything reachable DOWN any base edge — a `parent`-spine child OR
  // a config that mixes this one in — is a specialization of it, i.e. a
  // descendant. "other" is reserved for genuinely lateral configs (e.g. a sibling
  // mixin co-applied alongside this one), which are neither upstream nor down.
  const ancestorKeys = getConfigAncestorKeys(config, byKey);
  const descendantKeys = new Set(
    getConfigSubtree(config.key, allConfigs).filter((k) => k !== config.key),
  );
  const relationOf = (
    configKey: string,
  ): ConfigKeyImplementation["relation"] => {
    if (configKey === config.key) return "self";
    if (ancestorKeys.has(configKey)) return "ancestor";
    if (descendantKeys.has(configKey)) return "descendant";
    return "other";
  };

  const featureById = new Map(allFeatures.map((f) => [f.id, f]));

  const sources: FeatureValueSource[] = allFeatures.map((f) => {
    const envSettings = (f.environmentSettings ?? {}) as Record<
      string,
      { rules?: ImplementingRule[] }
    >;
    const envRules = Object.values(envSettings).flatMap((e) => e?.rules ?? []);
    return {
      featureId: f.id,
      project: f.project || undefined,
      state: "live",
      defaultValue: f.defaultValue,
      rules: [...((f.rules ?? []) as ImplementingRule[]), ...envRules],
    };
  });

  for (const rev of drafts) {
    // Drafts come from an unfiltered revision query, so scope them to features
    // the caller can read (live features already are, via getAllFeatures) — else
    // the UI usage path leaks other-project draft override values. The
    // experiment-guard path passes an admin context that reads every feature, so
    // it still sees all drafts (and ignores non-live rows regardless).
    const feature = featureById.get(rev.featureId);
    if (!feature) continue;
    sources.push({
      featureId: rev.featureId,
      project: feature.project || undefined,
      state: "draft",
      revisionVersion: rev.version,
      defaultValue: rev.defaultValue,
      rules: (rev.rules ?? []) as ImplementingRule[],
    });
  }

  const implementations = computeConfigKeyImplementations(sources, familySet);
  for (const impl of implementations) {
    impl.relation = relationOf(impl.configKey);
  }

  // Resolve the linked analysis unit's name + status onto each implementation.
  // Experiment refs and contextual-bandit refs point at different collections but
  // share the same status vocabulary, so both fill the same experimentName/
  // experimentStatus fields and downstream consumers (badges, usage table,
  // experiment guard) treat them uniformly.
  const enrichRefs = async (
    pick: (i: ConfigKeyImplementation) => string | undefined,
    load: (
      ids: string[],
    ) => Promise<Array<{ id: string; name: string; status: string }>>,
  ) => {
    const ids = [
      ...new Set(implementations.map(pick).filter((id): id is string => !!id)),
    ];
    if (!ids.length) return;
    const byId = new Map((await load(ids)).map((e) => [e.id, e]));
    for (const impl of implementations) {
      const id = pick(impl);
      const ref = id ? byId.get(id) : undefined;
      if (ref) {
        impl.experimentName = ref.name;
        impl.experimentStatus = ref.status;
      }
    }
  };
  await enrichRefs(
    (i) => i.experimentId,
    (ids) => getExperimentsByIds(context, ids),
  );
  await enrichRefs(
    (i) => i.contextualBanditId,
    (ids) => context.models.contextualBandits.getByIds(ids),
  );

  return { familyKeys, implementations };
}

// Block archiving a still-referenced constant; unarchiving is always allowed.
export async function assertConstantArchivable(
  context: ReqContext | ApiReqContext,
  constantId: string,
  noun: "constant" | "config" = "constant",
): Promise<void> {
  // Resolve references over the whole org, not just readable projects: a
  // referencing feature/config in a project the actor can't read still breaks if
  // we archive its target (the resolver would silently scrub the now-archived
  // ref). Mirrors the unfiltered lineage check in getDependentConfigs. Only a
  // count is surfaced below, so this doesn't leak unreadable resource names.
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const refs = await loadConstantReferences(scanContext, constantId);
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

// Configs that depend on `configKey` as a base — either via the `parent` spine
// (inheritance) or via `extends` (composition mixin). Both edges break if the
// base disappears: a dangling `parent` pointer or a dangling mixin ref whose
// fields silently vanish from the composer's resolution. Uses the unfiltered set
// so a dependent in an unreadable project still blocks the guard (lineage is
// global).
async function getDependentConfigs(
  context: ReqContext | ApiReqContext,
  configKey: string,
): Promise<ConfigInterface[]> {
  const all = await context.models.configs.getAllForReconcile();
  return all.filter(
    (c) =>
      c.key !== configKey &&
      (getConfigParentKey(c) === configKey ||
        (c.extends ?? []).includes(configKey)),
  );
}

// True when a config's live value is an empty patch (`{}`) — archiving it is a
// no-op for every served payload, so it's always allowed. Exported for testing.
export function isEmptyConfigPatch(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const v = JSON.parse(value);
    return (
      !!v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length === 0
    );
  } catch {
    return false;
  }
}

// Whether archiving this child config would change a value some feature serves:
// it's referenced directly (a feature/config embeds `@config:key`), or it's an
// env/project override whose base is referenced (the flavor patches the base's
// served value, so archiving it reverts affected features to the base). A flavor
// can be selected by more than one base, so ANY referenced selecting base counts.
// Uses the unfiltered scan context so a reference in an unreadable project still
// counts.
async function childConfigIsServed(
  scanContext: ReqContext | ApiReqContext,
  config: { id: string; key: string },
  selectingBases: ConfigInterface[],
): Promise<boolean> {
  const direct = await loadConstantReferences(scanContext, config.id);
  if (direct && totalConstantReferences(direct) > 0) return true;

  for (const base of selectingBases) {
    const baseRefs = await loadConstantReferences(scanContext, base.id);
    if (baseRefs && totalConstantReferences(baseRefs) > 0) return true;
  }
  return false;
}

// Block archiving a config. A live config depending on it as a base (via
// `parent`/`extends`) is always a hard block — archiving would dangle their
// lineage. Beyond that:
//   - Root config: keep the strict reference block — archiving strips its value
//     from everything that references it.
//   - Child config (parent-chain child, mixin child, or env/project override):
//     always allowed when it can't change a served payload — its live value is
//     an empty patch (a no-op) or nothing serves it. When it IS live-serving,
//     archiving reverts affected features to the base value, so it soft-warns
//     (bypass with `?ignoreWarnings=true` / an "archive anyway" confirmation)
//     rather than serving a surprise.
// Unarchiving is always allowed.
export async function assertConfigArchivable(
  context: ReqContext | ApiReqContext,
  config: {
    id: string;
    key: string;
    value?: string;
    parent?: string;
    extends?: string[];
  },
): Promise<void> {
  const liveDependents = (
    await getDependentConfigs(context, config.key)
  ).filter((c) => !c.archived);
  if (liveDependents.length) {
    throw new BadRequestError(
      `Cannot archive config: ${liveDependents.length} live config(s) depend on it (${liveDependents
        .map((c) => c.key)
        .join(
          ", ",
        )}). Re-parent or remove the mixin from them, or archive them first.`,
    );
  }

  // Bases that select this config as an env/project override "flavor". A flavor
  // need not carry a `parent`/`extends` — it can be a plain config attached
  // purely via a base's scopedOverrides — so this membership is what makes it a
  // child, independent of lineage fields.
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const selectingBases = allConfigs.filter((c) =>
    (c.scopedOverrides ?? []).some((o) => o.config === config.key),
  );

  // A child derives from a base — a parent spine, a composition mixin, or (as an
  // env/project override) selection by some base's scopedOverrides. A root has
  // none of these.
  const isChild =
    (getConfigParentKey(config) ?? null) !== null ||
    (config.extends ?? []).length > 0 ||
    selectingBases.length > 0;

  if (!isChild) {
    // Root: archiving strips its value from everything that references it.
    await assertConstantArchivable(context, config.id, "config");
    return;
  }

  // (a) Empty live patch → archiving changes nothing served.
  if (isEmptyConfigPatch(config.value)) return;

  // (b) Nothing serves it → safe to archive.
  if (!(await childConfigIsServed(scanContext, config, selectingBases))) return;

  // (c) Live-serving child: acknowledge before reverting affected features.
  if (context.ignoreWarnings) return;
  throw new SoftWarningError(
    `Archiving "${config.key}" changes a served value. Re-submit with ignoreWarnings to archive anyway.`,
    [
      `Archiving "${config.key}" reverts any feature that resolves it to the base value.`,
    ],
  );
}

// Block deleting a config that any other config still depends on as a base
// (archived or not) — via `parent` or `extends`. Deletion would dangle their
// `parent` pointer or `extends` mixin ref.
export async function assertConfigDeletable(
  context: ReqContext | ApiReqContext,
  config: { id: string; key: string },
): Promise<void> {
  const dependents = await getDependentConfigs(context, config.key);
  if (dependents.length) {
    throw new BadRequestError(
      `Cannot delete config: ${dependents.length} config(s) depend on it (${dependents
        .map((c) => c.key)
        .join(
          ", ",
        )}). Re-parent or remove the mixin from them, or delete them first.`,
    );
  }
}

// Validate a config's scopedOverrides selection list on write (create/update):
// structural problems (self-reference, an entry an earlier one already subsumes)
// plus dangling references (a `config` that isn't a real config). A flavor is an
// ordinary child config, so entries must point at configs that already exist —
// flavors are created first, then attached to the parent. Hard error: a malformed
// selection list is a client mistake, not an impact warning.
export async function assertScopedOverridesValid(
  context: ReqContext | ApiReqContext,
  config: {
    key: string;
    project?: string;
    scopedOverrides?: ScopedOverrideEntry[];
  },
  // The entries already on the config, so checks below only reject NEWLY-added
  // refs — a parent whose flavor was later archived (or attached elsewhere by
  // legacy data) stays editable.
  prevOverrides: ScopedOverrideEntry[] = [],
): Promise<void> {
  const overrides = config.scopedOverrides ?? [];
  if (!overrides.length) return;

  const errors = findScopedOverrideStructuralErrors(overrides, config.key);

  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));
  const dangling = [
    ...new Set(
      overrides
        .map((o) => o.config)
        // Self-references are reported by the structural check; don't double-count.
        .filter((k) => k !== config.key && !byKey.has(k)),
    ),
  ];
  if (dangling.length) {
    errors.push(
      `Scoped override references unknown config(s): ${dangling
        .map((k) => `"${k}"`)
        .join(", ")}.`,
    );
  }

  const prevKeys = new Set(prevOverrides.map((o) => o.config));
  const newKeys = [
    ...new Set(
      overrides
        .map((o) => o.config)
        .filter((k) => !prevKeys.has(k) && k !== config.key && byKey.has(k)),
    ),
  ];
  for (const key of newKeys) {
    const flavor = byKey.get(key);
    if (flavor?.archived) {
      errors.push(
        `"${key}" is archived and would never serve — unarchive it first.`,
      );
    }
    // The resolver scrubs a flavor whose own project differs from the feature
    // being resolved — a cross-project attachment would silently never apply.
    if (
      flavor?.project &&
      (config.project ?? "") &&
      flavor.project !== config.project
    ) {
      errors.push(
        `"${key}" belongs to a different project than "${config.key}" and would never serve.`,
      );
    }
    // A flavor belongs to exactly one base: its derived scopedConfig marker and
    // approval scoping are single-valued.
    const otherBase = all.find(
      (b) =>
        b.key !== config.key &&
        (b.scopedOverrides ?? []).some((o) => o.config === key),
    );
    if (otherBase) {
      errors.push(
        `"${key}" is already an environment override of "${otherBase.key}" — a config can only override one base.`,
      );
    }
  }

  if (errors.length) throw new BadRequestError(errors.join(" "));
}

// Approval gate for the immediate scopedOverrides write. Attaching, detaching,
// re-scoping, or reordering a VALUE-BEARING flavor changes served values with
// no reviewable revision — when the org requires review for the affected
// project/environments, that shortcut needs review-bypass privileges. Attaching
// an empty-patch flavor (the UI create flow) stays free.
export async function assertScopedOverridesChangeAllowed(
  context: ReqContext | ApiReqContext,
  config: ConfigInterface,
  prevOverrides: ScopedOverrideEntry[],
  nextOverrides: ScopedOverrideEntry[],
): Promise<void> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));
  const impactful = (list: ScopedOverrideEntry[]) =>
    list.filter((o) => {
      const flavor = byKey.get(o.config);
      if (!flavor || flavor.archived) return false;
      const obj = parsePlainJSONObject(flavor.value ?? "");
      return !obj || Object.keys(obj).length > 0;
    });
  const before = impactful(prevOverrides);
  const after = impactful(nextOverrides);
  if (isEqual(before, after)) return;

  // Entries that differ carry the affected env scope; a pure reorder (empty
  // diff) can still change first-match selection, so it affects them all.
  const diff = [
    ...after.filter((o) => !before.some((b) => isEqual(b, o))),
    ...before.filter((o) => !after.some((a) => isEqual(a, o))),
  ];
  const affected = diff.length ? diff : [...before, ...after];
  const affectsAllEnvs = affected.some((o) => !o.environments?.length);
  const changedEnvironments = [
    ...new Set(affected.flatMap((o) => o.environments ?? [])),
  ];

  const requiresReview = constantRequiresReview(
    config,
    affectsAllEnvs
      ? { valueChanged: true, changedEnvironments: [], metadataOnly: false }
      : { valueChanged: false, changedEnvironments, metadataOnly: false },
    context.org.settings,
  );
  if (!requiresReview) return;
  if (
    context.permissions.canBypassApprovalChecks({
      project: config.project || "",
    })
  ) {
    return;
  }
  throw new BadRequestError(
    "This scoped-overrides change alters values served in environments that require review. " +
      "Publish value changes through the override's own review flow, or have someone with approval-bypass privileges change the scoping.",
  );
}

// Stamp/refresh the self-describing `scopedConfig` marker on each flavor a
// parent now selects, and clear it on any flavor it no longer selects. Called
// immediately after a parent's scopedOverrides is written; the parent's
// scopedOverrides stays the source of truth for resolution. System writes (a
// flavor may live in a project the editor can't touch).
export async function syncScopedConfigMarkers(
  context: ReqContext | ApiReqContext,
  parentKey: string,
  prevOverrides: ScopedOverrideEntry[],
  nextOverrides: ScopedOverrideEntry[],
): Promise<void> {
  const nextByKey = new Map(nextOverrides.map((o) => [o.config, o]));

  // Clear the marker on flavors this parent no longer selects.
  for (const prev of prevOverrides) {
    if (nextByKey.has(prev.config)) continue;
    const flavor = await context.models.configs.getByKey(prev.config);
    // Only clear a marker that points at THIS parent — don't stomp a flavor
    // that another parent legitimately owns.
    if (flavor && flavor.scopedConfig?.parent === parentKey) {
      await context.models.configs.dangerousUpdateBypassPermission(flavor, {
        scopedConfig: null,
      });
    }
  }

  // Stamp/refresh the marker on currently-selected flavors.
  for (const entry of nextByKey.values()) {
    const flavor = await context.models.configs.getByKey(entry.config);
    if (!flavor) continue;
    const marker = {
      parent: parentKey,
      ...(entry.environments?.length
        ? { environments: entry.environments }
        : {}),
      ...(entry.projects?.length ? { projects: entry.projects } : {}),
    };
    if (!isEqual(flavor.scopedConfig ?? null, marker)) {
      await context.models.configs.dangerousUpdateBypassPermission(flavor, {
        scopedConfig: marker,
      });
    }
  }
}

// After a config is deleted, drop any scopedOverrides entry on other configs
// that pointed at it. System write: the deleter acted on the flavor, and the
// parent may live in a project they can't edit.
export async function pruneScopedOverridesReferencing(
  context: ReqContext | ApiReqContext,
  deletedKey: string,
): Promise<void> {
  const all = await context.models.configs.getAllForReconcile();
  const referencing = all.filter((c) =>
    (c.scopedOverrides ?? []).some((o) => o.config === deletedKey),
  );
  for (const c of referencing) {
    const pruned = (c.scopedOverrides ?? []).filter(
      (o) => o.config !== deletedKey,
    );
    await context.models.configs.dangerousUpdateBypassPermission(c, {
      scopedOverrides: pruned,
    });
  }
}
