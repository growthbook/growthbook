import {
  resolveConfigChain,
  linearizeConfigDag,
  getConfigSpineRootKey,
  configIsExtensible,
  configChainDeclaresReferenceLayer,
  parsePlainJSONObject,
  validateConfigValue,
  findIncompatibleConfigValueKeys,
  collectConfigInvariantViolations,
  collectDescendantInvariantViolations,
  getConfigBackingKey,
  getConfigBackingPatch,
  selectScopedOverride,
} from "shared/util";
import {
  FeatureInterface,
  FeatureRule,
  SchemaField,
  SimpleSchema,
} from "shared/types/feature";
import { ConfigInterface } from "shared/types/config";
import { Revision } from "shared/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { runValidateConfigRevisionHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import { BadRequestError, SoftWarningError } from "back-end/src/util/errors";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

// The leaf config we're validating, with optional draft overrides for the
// schema / parent / extends so a draft edit is judged against the lineage it's
// also setting (not the stale live one).
type ConfigLeaf = Pick<ConfigInterface, "key" | "name" | "value"> & {
  schema?: SimpleSchema;
  parent?: string;
  extends?: string[];
  extensible?: boolean;
};

// Resolve a config's effective schema fields + extensibility across its full
// base DAG (parent + every `extends` mixin) — the same accumulation
// `getConfigSchema` exposes via `?effective=true`. The leaf's own
// schema/parent/extends may be overridden to reflect a draft's proposed state.
export async function getEffectiveConfigSchema(
  context: Context,
  leaf: ConfigLeaf,
): Promise<{ fields: SchemaField[]; additionalProperties: boolean }> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map<string, ConfigInterface>(all.map((c) => [c.key, c]));
  // Inject the draft leaf so its proposed schema/parent/extends drive the walk.
  byKey.set(leaf.key, { ...byKey.get(leaf.key), ...leaf } as ConfigInterface);
  const chain = linearizeConfigDag(leaf.key, byKey);
  // Extensibility is governed by the `parent`-spine root's checkbox; mixin
  // bases' extensibility is ignored under composition.
  const spineRoot = byKey.get(getConfigSpineRootKey(leaf.key, byKey));
  return {
    fields: resolveConfigChain(chain).effectiveSchema,
    additionalProperties: configIsExtensible(
      spineRoot,
      context.org.settings?.configsExtensibleByDefault,
    ),
  };
}

type ConfigValues = {
  value?: string;
};

// Collect (don't throw) every schema-conformance error for a config's staged
// value(s) against its effective schema. Values are sparse (a child only sets
// the keys it overrides), so `required` is NOT enforced; type/extensibility
// conformance of present keys is.
async function collectConfigValueErrors(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<string[]> {
  const { fields, additionalProperties } = await getEffectiveConfigSchema(
    context,
    leaf,
  );
  const errors: string[] = [];
  const check = (raw: string | undefined, label: string) => {
    if (raw === undefined || raw === "") return;
    const obj = parsePlainJSONObject(raw);
    // Non-object / unparseable values are caught upstream by
    // validateResolvableValue; nothing to schema-check here.
    if (!obj) return;
    const res = validateConfigValue({
      value: obj,
      fields,
      additionalProperties,
    });
    if (!res.valid) errors.push(`${label}: ${res.errors.join(", ")}`);
  };
  check(values.value, "value");
  return errors;
}

// Enforce that a config's staged value(s) conform to its effective schema —
// the config analog of `assertFeatureValuesValid`. Block-vs-warn is governed by
// the org's `blockPublishOnSchemaError` (default true = block): when false,
// writes are never blocked here (the mismatch is surfaced as `incompatibleFields`
// on reads instead). Opt out per-request with ?skipSchemaValidation=true.
export async function assertConfigValueValid(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<void> {
  if (context.skipSchemaValidation) return;
  // Warn-only mode: never block a write; the editor + REST surface the issue.
  if (context.org.settings?.blockPublishOnSchemaError === false) return;
  const errors = await collectConfigValueErrors(context, leaf, values);
  if (errors.length) throw new BadRequestError(errors.join("; "));
}

// The config's own value keys that no longer conform to its effective
// (inherited) schema — the "incompatible, must fix" state. Surfaced on reads
// (REST + editor) and flagged in the lineage; never blocks serving the value.
export async function getIncompatibleConfigFields(
  context: Context,
  leaf: ConfigLeaf,
): Promise<string[]> {
  const { fields } = await getEffectiveConfigSchema(context, leaf);
  const incompatible = new Set<string>();
  for (const raw of [leaf.value]) {
    const obj = parsePlainJSONObject(raw ?? "");
    if (!obj) continue;
    for (const k of findIncompatibleConfigValueKeys({
      value: obj,
      fields,
    })) {
      incompatible.add(k);
    }
  }
  return [...incompatible];
}

// Required fields can only be enforced against a fully-resolved value — sparse
// own values rely on inheritance to fill the rest. This resolves the leaf's
// default value across its base DAG (own value merged onto inherited base
// values) and reports required fields that remain unset and have no schema
// default. Env overrides inherit from the resolved default, so checking the
// default alone is sufficient. Reference-backed keys count as set.
async function collectMissingRequiredFields(
  context: Context,
  leaf: ConfigLeaf,
  rawValue: string | undefined,
): Promise<string[]> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map<string, ConfigInterface>(all.map((c) => [c.key, c]));
  byKey.set(leaf.key, {
    ...byKey.get(leaf.key),
    ...leaf,
    // Resolve against the staged value, not the stored one.
    value: rawValue ?? leaf.value,
  } as ConfigInterface);
  const chain = linearizeConfigDag(leaf.key, byKey);
  // A `@const:`/`@config:` `$extends` layer supplies fields we can't resolve at
  // gate time, so treat required fields as satisfied (same exemption as
  // reference-backed own keys).
  if (configChainDeclaresReferenceLayer(chain)) return [];
  const { effectiveSchema, fields } = resolveConfigChain(chain);
  const resolvedKeys = new Set(
    fields.filter((f) => f.source !== null).map((f) => f.key),
  );
  const missing = effectiveSchema
    .filter((f) => f.required && f.default === "" && !resolvedKeys.has(f.key))
    .map((f) => f.key);
  if (!missing.length) return [];
  return [
    `value: missing required field(s) ${missing
      .map((k) => `"${k}"`)
      .join(", ")}`,
  ];
}

// Re-collect invariant violations per flavor-overridden environment (base ⊕
// flavor ⊕ any leaf patch modeled in `byKey`) — a cross-field invariant can
// pass env-agnostic yet fail once a flavor applies. Only invariants differ per
// env (schema/type conformance is env-agnostic); envs without a flavor resolve
// to the base and are already covered by the plain pass.
function collectFlavorInvariantViolations(
  leafKey: string,
  byKey: Map<string, ConfigInterface>,
  project: string,
  // Org environment ids — a wildcard/project-only entry (no `environments`)
  // applies in every named environment, so those must all be checked.
  allEnvironments: string[],
): { environment: string; message: string }[] {
  const lineageKeys = linearizeConfigDag(leafKey, byKey).map((n) => n.key);
  const environments = new Set<string>();
  for (const key of lineageKeys) {
    for (const o of byKey.get(key)?.scopedOverrides ?? []) {
      if (!o.environments?.length)
        allEnvironments.forEach((e) => environments.add(e));
      else o.environments.forEach((e) => environments.add(e));
    }
  }
  if (!environments.size) return [];

  const out: { environment: string; message: string }[] = [];
  for (const environment of environments) {
    // Layer each lineage config's scope-selected flavor patch on top of its own
    // value (via `variantPatch`), mirroring the SDK resolver. Skip archived,
    // missing, and cross-project flavors, same as resolution.
    const withFlavors = new Map<string, ConfigInterface>(byKey);
    for (const key of lineageKeys) {
      const node = byKey.get(key);
      if (!node?.scopedOverrides?.length) continue;
      const flavorKey = selectScopedOverride(
        node.scopedOverrides,
        { environment, project },
        (k) => {
          const f = byKey.get(k);
          return !!f && !f.archived && (!f.project || f.project === project);
        },
      );
      const flavor = flavorKey ? byKey.get(flavorKey) : undefined;
      if (!flavor) continue;
      // Keep the flavor's `$extends` intact so configChainDeclaresReferenceLayer
      // sees it — a flavor extending its own ref bases exempts (not falsely
      // flags) fields those bases supply. resolveConfigChain ignores it anyway.
      withFlavors.set(key, {
        ...node,
        variantPatch: flavor.value,
      } as ConfigInterface);
    }
    for (const vi of collectConfigInvariantViolations(leafKey, withFlavors)) {
      out.push({ environment, message: vi.message });
    }
  }
  return out;
}

// Cross-field invariants (relational rules JSON Schema can't express),
// evaluated against the fully-resolved value at publish. Invariants accumulate
// across the lineage (base→leaf, leaf wins on name). Descendants are checked
// too — this publish changes their resolved values — but only violations
// INTRODUCED by this publish are reported (diffed against the live family), so
// a pre-existing broken descendant never blocks unrelated publishes.
async function collectInvariantViolations(
  context: Context,
  leaf: ConfigLeaf,
  rawValue: string | undefined,
): Promise<string[]> {
  const all = await context.models.configs.getAllForReconcile();
  const proposed = new Map<string, ConfigInterface>(all.map((c) => [c.key, c]));
  proposed.set(leaf.key, {
    ...proposed.get(leaf.key),
    ...leaf,
    value: rawValue ?? leaf.value,
  } as ConfigInterface);

  const rootViolations = collectConfigInvariantViolations(leaf.key, proposed);
  const errors = rootViolations.map((vi) => vi.message);

  // Also validate each per-environment resolved value (base ⊕ flavor): a value
  // change can satisfy invariants at the base yet violate them once an env flavor
  // applies. Tag by environment so the author knows which env fails.
  for (const { environment, message } of collectFlavorInvariantViolations(
    leaf.key,
    proposed,
    proposed.get(leaf.key)?.project ?? "",
    getEnvironmentIdsFromOrg(context.org),
  )) {
    errors.push(`[${environment}] ${message}`);
  }

  const descendants = collectDescendantInvariantViolations(leaf.key, proposed);
  if (!descendants.length) return errors;

  // Live-family baseline for the introduced-only diff.
  const preExisting = new Set(
    collectDescendantInvariantViolations(
      leaf.key,
      new Map<string, ConfigInterface>(all.map((c) => [c.key, c])),
    ).flatMap((d) =>
      d.violations.map((vi) => `${d.configKey}\n${vi.name}\n${vi.message}`),
    ),
  );
  // A root violation echoes into every non-overriding descendant; the root's
  // own message subsumes those.
  const reportedOnRoot = new Set(
    rootViolations.map((vi) => `${vi.name}\n${vi.message}`),
  );
  for (const d of descendants) {
    for (const vi of d.violations) {
      if (preExisting.has(`${d.configKey}\n${vi.name}\n${vi.message}`)) {
        continue;
      }
      if (reportedOnRoot.has(`${vi.name}\n${vi.message}`)) continue;
      errors.push(
        `descendant "${d.configName ?? d.configKey}" (${d.configKey}): ${vi.message}`,
      );
    }
  }
  return errors;
}

// Publish-time safety net for configs (the analog of
// `assertFeatureValuesValidForPublish`). When the org's
// `blockPublishOnSchemaError` is true (default) a mismatch blocks the publish;
// when false it's a bypassable soft warning. Unlike the per-write check, publish
// also enforces required fields against the fully-resolved value.
export async function assertConfigValueValidForPublish(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
  // The revision being published, when available — lets a hook gate the publish
  // on approval policy (reviews/status). Absent for direct (non-revision) writes.
  revision?: Revision,
): Promise<void> {
  // Customer-defined publish-time checks (sandboxed, self-host + enterprise).
  // A separate gate from schema validation — runs on every publish path
  // (including bypass-approval / schema-skip), can hard-block or soft-warn.
  const stored = await context.models.configs.getByKey(leaf.key);
  await runValidateConfigRevisionHooks({
    context,
    config: {
      key: leaf.key,
      name: leaf.name,
      project: stored?.project ?? "",
      value: values.value,
      schema: leaf.schema,
      parent: leaf.parent,
      extends: leaf.extends,
      extensible: leaf.extensible,
    },
    // Pre-publish state, so `incrementalChangesOnly` hooks can suppress
    // errors/warnings that already existed before this change.
    original: stored
      ? {
          key: stored.key,
          name: stored.name,
          project: stored.project ?? "",
          value: stored.value,
          schema: stored.schema,
          parent: stored.parent,
          extends: stored.extends,
          extensible: stored.extensible,
        }
      : null,
    revision: revision
      ? {
          version: revision.version,
          status: revision.status,
          title: revision.title,
          comment: revision.comment,
          authorId: revision.authorId,
          contributors: revision.contributors,
          reviews: revision.reviews.map((r) => ({
            userId: r.userId,
            decision: r.decision,
            comment: r.comment,
            stale: r.stale,
            dateCreated: r.dateCreated,
          })),
        }
      : undefined,
  });

  if (context.skipSchemaValidation) return;
  const errors = [
    ...(await collectConfigValueErrors(context, leaf, values)),
    ...(await collectMissingRequiredFields(context, leaf, values.value)),
    ...(await collectInvariantViolations(context, leaf, values.value)),
  ];
  if (!errors.length) return;
  // Default to blocking when the setting is absent.
  if (context.org.settings?.blockPublishOnSchemaError === false) {
    // Warn mode: a bypassable soft warning (?ignoreWarnings=true), consistent
    // with the rest of the publish flow.
    if (context.ignoreWarnings) return;
    throw new SoftWarningError(
      "Publishing config value(s) that don't match the schema:\n" +
        errors.join("\n"),
      errors,
    );
  }
  throw new BadRequestError(errors.join("; "));
}

// Cross-field invariants, enforced from the revision adapter's applyChanges so
// EVERY publish path (direct, scheduled publish, autopublish-on-approval) runs
// them against the revision's *proposed* (draft) resolved value — not the live
// one. Honors the same block-vs-warn + skip settings as the schema check.
// Creation is a go-live event: a new config is served immediately, so enforce
// required fields + cross-field invariants with the same block/warn semantics
// as publish. Schema conformance is already checked by assertConfigValueValid,
// and validateConfigRevision hooks are deliberately not run — creation isn't a
// revision event, and validateConfig hooks already gate creates.
export async function assertConfigValueValidForCreate(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<void> {
  if (context.skipSchemaValidation) return;
  const errors = [
    ...(await collectMissingRequiredFields(context, leaf, values.value)),
    ...(await collectInvariantViolations(context, leaf, values.value)),
  ];
  if (!errors.length) return;
  if (context.org.settings?.blockPublishOnSchemaError === false) {
    if (context.ignoreWarnings) return;
    throw new SoftWarningError(
      "Creating a config whose value doesn't satisfy the schema:\n" +
        errors.join("\n"),
      errors,
    );
  }
  throw new BadRequestError(errors.join("; "));
}

export async function assertConfigInvariantsValid(
  context: Context,
  leaf: ConfigLeaf,
  rawValue: string | undefined,
): Promise<void> {
  if (context.skipSchemaValidation) return;
  const errors = await collectInvariantViolations(context, leaf, rawValue);
  if (!errors.length) return;
  if (context.org.settings?.blockPublishOnSchemaError === false) {
    if (context.ignoreWarnings) return;
    throw new SoftWarningError(
      "Publishing config value(s) that violate a validation rule:\n" +
        errors.join("\n"),
      errors,
    );
  }
  throw new BadRequestError(errors.join("; "));
}

// Validate a config-backed feature's values against the backing config's schema
// and invariants. Each value is an override patch on a config (its own
// `@config:` ref, else the feature's `baseConfig`); the patch's fields must
// conform to the config's effective schema, and the patch merged onto the
// config's resolved value must satisfy the config's invariants. Blocking follows
// the org's `blockPublishOnSchemaError` (bypassable soft warning when false);
// opt out with ?skipSchemaValidation=true.
// A config-backed feature's default value must be EXACTLY a config — config
// selection lives in `defaultValueConfig` (the base or a descendant), and inline
// overrides/extensions on the default aren't allowed. Shared values belong in the
// config; feature-specific ones in a descendant config. (Rules may still extend
// their config — this applies to the default only.) Structural + cheap, so it's
// enforced on every default-setting path (draft edits + create/update + publish)
// and NOT gated by skipSchemaValidation.
export function assertConfigBackedDefaultHasNoOverrides(
  feature: Pick<FeatureInterface, "valueType" | "baseConfig">,
  defaultValue: string | undefined,
): void {
  if (feature.valueType !== "json" || defaultValue === undefined) return;
  const defaultConfig =
    getConfigBackingKey(defaultValue) ?? feature.baseConfig ?? null;
  if (!defaultConfig) return;
  // A config-backed default must contribute nothing beyond the config ref; the
  // only allowed residue is an empty object. Reject a non-empty object patch AND
  // any non-object value — the SDK serves the latter verbatim and drops the config
  // entirely (features.ts valueForSDK "replace" branch), a worse override still.
  const patchStr = getConfigBackingPatch(defaultValue).trim();
  const patch = parsePlainJSONObject(patchStr);
  const hasOverride = patch ? Object.keys(patch).length > 0 : patchStr !== "";
  if (hasOverride) {
    throw new BadRequestError(
      "A config-backed feature's default value can't carry its own overrides — it must be exactly a config. " +
        "Put shared values in the config, or point the default at a descendant config (defaultValueConfig) for feature-specific values.",
    );
  }
}

// The value strings the config net reads from a rule, by type — the fields
// whose change makes a rule worth re-validating.
export function configCheckedRuleValues(
  rule: FeatureRule,
): (string | undefined)[] {
  switch (rule.type) {
    case "force":
    case "rollout":
      return [rule.value];
    case "experiment-ref":
    case "contextual-bandit-ref":
      return (rule.variations ?? []).map((v) => v.value);
    case "experiment":
      return (rule.values ?? []).map((v) => v.value);
    case "safe-rollout":
      return [rule.controlValue, rule.variationValue];
    default:
      return [];
  }
}

export async function assertConfigBackedFeatureValuesValid(
  context: Context,
  feature: Pick<FeatureInterface, "valueType" | "baseConfig" | "project">,
  values: { defaultValue?: string; rules?: FeatureRule[] },
): Promise<void> {
  assertConfigBackedDefaultHasNoOverrides(feature, values.defaultValue);

  if (context.skipSchemaValidation) return;
  if (feature.valueType !== "json") return;

  const backed: { config: string; patch: string; label: string }[] = [];
  const add = (raw: string | undefined, label: string) => {
    if (raw === undefined) return;
    const config = getConfigBackingKey(raw) ?? feature.baseConfig ?? null;
    if (!config) return;
    backed.push({ config, patch: getConfigBackingPatch(raw), label });
  };
  add(values.defaultValue, "Default value");
  for (const rule of values.rules ?? []) {
    if (rule.type === "force" || rule.type === "rollout") {
      add(rule.value, "Rule value");
    } else if (
      rule.type === "experiment-ref" ||
      rule.type === "contextual-bandit-ref"
    ) {
      rule.variations?.forEach((v, i) => add(v.value, `Variation ${i + 1}`));
    } else if (rule.type === "experiment") {
      rule.values?.forEach((v, i) => add(v.value, `Variation ${i + 1}`));
    } else if (rule.type === "safe-rollout") {
      add(rule.controlValue, "Control value");
      add(rule.variationValue, "Variation value");
    }
  }
  if (!backed.length) return;

  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map<string, ConfigInterface>(all.map((c) => [c.key, c]));
  const extensibleDefault = context.org.settings?.configsExtensibleByDefault;
  // Not a valid config key (leading underscore), so it can't collide with a real
  // config when modeling the patch as a lineage child for invariant evaluation.
  const PATCH_KEY = "__feature_patch__";

  const errors: string[] = [];
  for (const { config, patch, label } of backed) {
    // The backing config no longer exists (deleted/renamed, or a stale
    // `@config:` token). There's no schema to check against — skip rather than
    // treat an empty schema as "closed" and reject every field.
    if (!byKey.has(config)) continue;

    const patchObj = parsePlainJSONObject(patch);
    // Non-object patches (arrays/scalars) replace rather than merge onto the
    // config's object shape, so there's nothing to schema-check.
    if (!patchObj) continue;

    const { effectiveSchema } = resolveConfigChain(
      linearizeConfigDag(config, byKey),
    );
    const spineRoot = byKey.get(getConfigSpineRootKey(config, byKey));
    const res = validateConfigValue({
      value: patchObj,
      fields: effectiveSchema,
      additionalProperties: configIsExtensible(spineRoot, extensibleDefault),
    });
    if (!res.valid) errors.push(`${label}: ${res.errors.join(", ")}`);

    const withPatch = new Map(byKey);
    withPatch.set(PATCH_KEY, {
      key: PATCH_KEY,
      parent: config,
      value: patch,
    } as ConfigInterface);
    for (const vi of collectConfigInvariantViolations(PATCH_KEY, withPatch)) {
      errors.push(`${label}: ${vi.message}`);
    }
    // Per-environment shipping shape: base ⊕ env-flavor ⊕ this value's patch. A
    // cross-field invariant can pass the env-agnostic check above yet fail once a
    // flavor applies for a specific environment.
    for (const { environment, message } of collectFlavorInvariantViolations(
      PATCH_KEY,
      withPatch,
      feature.project ?? "",
      getEnvironmentIdsFromOrg(context.org),
    )) {
      errors.push(`${label} [${environment}]: ${message}`);
    }
  }
  if (!errors.length) return;

  if (context.org.settings?.blockPublishOnSchemaError === false) {
    if (context.ignoreWarnings) return;
    throw new SoftWarningError(
      "Config-backed value(s) don't conform to the config's schema:\n" +
        errors.join("\n"),
      errors,
    );
  }
  throw new BadRequestError(errors.join("; "));
}
