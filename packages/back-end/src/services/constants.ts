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
  getConfigBackingPatch,
  getFeatureBaseConfigKey,
  parsePlainJSONObject,
} from "shared/util";
import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import { ConstantSource } from "shared/sdk-versioning";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
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
  for (const r of resolvables) {
    for (const ns of ["constant", "config"] as const) {
      for (const refKey of getConstantReferenceKeys(
        r.value,
        r.environmentValues,
        ns,
      )) {
        const token = refToken(ns, refKey);
        const entry: ResolvableRef = { source: r.source, key: r.key };
        const list = referencedBy.get(token);
        if (list) list.push(entry);
        else referencedBy.set(token, [entry]);
      }
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
  const configs = await context.models.configs.getAll();
  const configIds = new Set(configs.map((c) => c.id));
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
// The lineage family of a config: its root ancestor's whole subtree (the config,
// its ancestors, and all descendants). Null if the config doesn't exist. Returns
// the loaded configs so callers can reason about lineage without re-querying.
async function resolveConfigFamily(
  context: ReqContext | ApiReqContext,
  configId: string,
): Promise<{
  config: ConfigInterface;
  allConfigs: ConfigInterface[];
  byKey: Map<string, ConfigInterface>;
  familyKeys: string[];
} | null> {
  // The target config is already in `getAll`, so find it there rather than
  // paying for a separate `getById`.
  const allConfigs = await context.models.configs.getAll();
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
// experiment's name and status.
export type ConfigKeyImplementation = {
  featureId: string;
  project?: string;
  location: "defaultValue" | "rule";
  ruleType?: string;
  ruleId?: string;
  experimentId?: string;
  experimentName?: string;
  experimentStatus?: string;
  variationId?: string;
  configKey: string;
  // The backing config's relationship to the config being viewed.
  relation?: "self" | "ancestor" | "descendant" | "other";
  keys: string[];
  state: "live" | "draft";
  revisionVersion?: number;
};

type ImplementingRule = {
  type?: string;
  id?: string;
  experimentId?: string;
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

// The config field keys a stored value overrides: its patch's own keys, minus
// the `$extends` slot (which only carries reference tokens, not field data).
function overriddenConfigKeys(value: string): string[] {
  const patch = parsePlainJSONObject(getConfigBackingPatch(value));
  if (!patch) return [];
  return Object.keys(patch).filter((k) => k !== CONSTANT_EXTENDS_KEY);
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
      "ruleType" | "ruleId" | "experimentId" | "variationId"
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

    const keys = overriddenConfigKeys(value);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.keys = [...new Set([...existing.keys, ...keys])];
      return;
    }
    bySignature.set(signature, {
      featureId: source.featureId,
      project: source.project,
      location,
      configKey,
      keys,
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
      };
      addSlot(source, rule.value, "rule", base);
      for (const v of rule.variations ?? []) {
        addSlot(source, v.value, "rule", {
          ...base,
          variationId: v.variationId,
        });
      }
      for (const v of rule.values ?? []) {
        addSlot(source, v.value, "rule", {
          ...base,
          variationId: v.variationId,
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
  const familySet = new Set(familyKeys);

  // Classify each backing config relative to the config being viewed, for the
  // "Config source" column.
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
    sources.push({
      featureId: rev.featureId,
      project: featureById.get(rev.featureId)?.project || undefined,
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

  const experimentIds = [
    ...new Set(
      implementations
        .map((i) => i.experimentId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (experimentIds.length) {
    const experiments = await getExperimentsByIds(context, experimentIds);
    const byId = new Map(experiments.map((e) => [e.id, e]));
    for (const impl of implementations) {
      const exp = impl.experimentId ? byId.get(impl.experimentId) : undefined;
      if (exp) {
        impl.experimentName = exp.name;
        impl.experimentStatus = exp.status;
      }
    }
  }

  return { familyKeys, implementations };
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

// Block archiving a config that is still referenced (value-embedded refs) OR
// that live configs depend on as a base — via `parent` (inheritance) or
// `extends` (composition). Archiving the base would break those dependents'
// resolution. Unarchiving is always allowed.
export async function assertConfigArchivable(
  context: ReqContext | ApiReqContext,
  config: { id: string; key: string },
): Promise<void> {
  await assertConstantArchivable(context, config.id, "config");

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
