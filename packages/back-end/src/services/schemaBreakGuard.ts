import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import {
  collectResolvedConfigValueViolations,
  configIsExtensible,
  getConfigSpineRootKey,
  getConfigBaseKeys,
  withConfigExtends,
  parsePlainJSONObject,
  deepMergePatch,
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantValueMap,
} from "shared/sdk-versioning";
import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import {
  getArmAcknowledgment,
  type ArmGuardId,
} from "back-end/src/services/armGuards";
import {
  resolvableDependencyClosure,
  featuresAffectedByResolvable,
} from "back-end/src/services/constants";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { collectFeatureConfigBackedValues } from "back-end/src/services/configValidation";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import {
  SoftWarningError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

const CONFIG_PREFIX = "config:";
const SCHEMA_BREAK: ArmGuardId = "schema-break";

// Resolve a direct (unarmed) publish's schema-break violations to an action:
// clear when none, bypass on ignoreWarnings / approval-bypass (logged), else a
// bypassable soft warning. Shared by the constant and config guards.
function resolveDirectSchemaBreak(
  context: Context,
  violations: string[],
  project: string | undefined,
  logKey: Record<string, unknown>,
  message: string,
): void {
  if (!violations.length) return;
  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({ project: project || "" });
  if (override) {
    logger.info(
      { ...logKey, userId: context.userId, violations },
      "Schema-break guard overridden on a direct publish",
    );
    return;
  }
  throw new SoftWarningError(
    message + "\n" + violations.join("\n"),
    violations,
  );
}

// Decide an ARMED (deferred) fire against the arm-time fingerprint: a violation
// that wasn't acknowledged when the publish was scheduled is a NEW break
// introduced since — the deferred publish is terminal (re-open + re-confirm).
// Acknowledged breaks stand (the armer already accepted them). Order-independent.
function assertArmedSchemaBreakAcknowledged(
  violations: string[],
  revision: Pick<Revision, "armAcknowledgments"> | undefined,
  entityMessage: string,
): void {
  const acknowledged = new Set(
    (revision && getArmAcknowledgment(revision, SCHEMA_BREAK)) ?? [],
  );
  const unacknowledged = violations.filter((v) => !acknowledged.has(v));
  if (!unacknowledged.length) return;
  throw new TerminalPublishError(
    `${entityMessage} since this publish was scheduled:\n${unacknowledged.join(
      "\n",
    )}\nRe-open the draft and re-confirm to publish.`,
  );
}

// Resolve a config to its concrete, fully-substituted value under `map` by
// resolving a synthetic `$extends` reference to it — the same config-layer
// resolution the SDK payload build uses (lineage + `@const:`/`@config:`
// substitution). Env-agnostic (no scoped-override flavors) — a base-value sanity
// check, not a per-environment payload. Returns null for a non-object result
// (nothing to schema-check).
function resolveConfigConcreteValue(
  configKey: string,
  map: ConstantValueMap,
  project: string,
): Record<string, unknown> | null {
  const resolved = resolveConstantRefs(
    { [CONSTANT_EXTENDS_KEY]: [`@config:${configKey}`] },
    map,
    new Set(),
    undefined,
    project,
    undefined,
  );
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? (resolved as Record<string, unknown>)
    : null;
}

// The schema/invariant violations a proposed constant value would INTRODUCE into
// the configs that (transitively) reference it — diffed against the current
// value so a pre-existing break never blocks an unrelated publish. Each affected
// config's resolved value is recomputed with the proposed constant substituted,
// then validated against its effective schema + invariants. This is where a
// config field backed by `@const:` finally gets checked against a concrete
// value (the ordinary config collectors exempt reference-backed fields).
//
// Configs only. Checked across every environment (plus the env-agnostic base):
// a constant carries per-environment values, so a change can break a dependent
// config in one environment but not another. A break present in every
// environment is reported once (untagged); an env-specific one is tagged with
// its environment. Config-backed FEATURE values are a documented follow-on.
export async function evaluateConstantSchemaBreakConflicts(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string | undefined,
): Promise<string[]> {
  // Org-wide scan (mirrors the other constant guards): a dependent config in any
  // project must be seen, even one the acting user can't read.
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const resolvables = await getResolvableValues(scanContext);

  const affectedConfigKeys = [
    ...resolvableDependencyClosure(resolvables, "constant", constant.key),
  ]
    .filter((t) => t.startsWith(CONFIG_PREFIX))
    .map((t) => t.slice(CONFIG_PREFIX.length));
  if (!affectedConfigKeys.length) return [];

  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  const extensibleDefault = context.org.settings?.configsExtensibleByDefault;

  // The proposed universe swaps only the changed constant's value; everything
  // else resolves identically, so the diff isolates violations this change
  // introduces. Per environment, buildConstantValueMap picks that env's constant
  // values, so resolution reflects what actually ships there.
  const proposedResolvables = resolvables.map((r) =>
    r.source === "constant" && r.key === constant.key
      ? { ...r, value: proposedValue ?? "" }
      : r,
  );

  // Violations this change introduces for one config in one environment.
  const introducedFor = (
    key: string,
    env: string,
    project: string,
    additionalProperties: boolean,
  ): string[] => {
    const current = resolveConfigConcreteValue(
      key,
      buildConstantValueMap(resolvables, env),
      project,
    );
    const proposed = resolveConfigConcreteValue(
      key,
      buildConstantValueMap(proposedResolvables, env),
      project,
    );
    if (!proposed) return [];
    const currentViolations = new Set(
      current
        ? collectResolvedConfigValueViolations({
            configKey: key,
            value: current,
            byKey,
            additionalProperties,
          })
        : [],
    );
    return collectResolvedConfigValueViolations({
      configKey: key,
      value: proposed,
      byKey,
      additionalProperties,
    }).filter((v) => !currentViolations.has(v));
  };

  const environments = getEnvironmentIdsFromOrg(context.org);
  const introduced: string[] = [];
  for (const key of affectedConfigKeys) {
    const cfg = byKey.get(key);
    if (!cfg) continue;
    const additionalProperties = configIsExtensible(
      byKey.get(getConfigSpineRootKey(key, byKey)),
      extensibleDefault,
    );
    const project = cfg.project || "";

    // Base (env-agnostic) first: anything it flags holds in every environment,
    // so per-env passes suppress the duplicate and only add env-specific breaks.
    const baseViolations = new Set(
      introducedFor(key, "", project, additionalProperties),
    );
    for (const v of baseViolations) introduced.push(`config "${key}": ${v}`);
    for (const env of environments) {
      for (const v of introducedFor(key, env, project, additionalProperties)) {
        if (!baseViolations.has(v)) {
          introduced.push(`config "${key}" [${env}]: ${v}`);
        }
      }
    }
  }
  return [...new Set(introduced)];
}

// The violations a proposed constant value would INTRODUCE into dependent
// config-backed FEATURE values (each value = its backing config resolved ⊕ the
// feature's override patch), checked against the backing config's schema +
// invariants, per environment, diffed vs current. Complements the config check:
// a feature's patch can combine with the changed constant to break a cross-field
// invariant that the config's own resolved value doesn't. Values with an empty
// patch are skipped — those resolve identically to the config and are already
// covered by evaluateConstantSchemaBreakConflicts.
async function evaluateConstantFeatureSchemaBreakConflicts(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string | undefined,
): Promise<string[]> {
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const [resolvables, features] = await Promise.all([
    getResolvableValues(scanContext),
    getAllFeatures(scanContext, {}),
  ]);
  const affected = featuresAffectedByResolvable(
    resolvables,
    features,
    "constant",
    constant.key,
  );
  if (!affected.length) return [];

  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  const extensibleDefault = context.org.settings?.configsExtensibleByDefault;
  const environments = getEnvironmentIdsFromOrg(context.org);
  const proposedResolvables = resolvables.map((r) =>
    r.source === "constant" && r.key === constant.key
      ? { ...r, value: proposedValue ?? "" }
      : r,
  );

  // The feature's shipped value for one config-backed slot in one environment:
  // the backing config resolved ⊕ the (also-resolved) override patch.
  const shippedValue = (
    config: string,
    patchObj: Record<string, unknown>,
    map: ConstantValueMap,
    project: string,
  ): Record<string, unknown> | null => {
    const base = resolveConfigConcreteValue(config, map, project);
    if (!base) return null;
    const resolvedPatch = resolveConstantRefs(
      patchObj,
      map,
      new Set(),
      undefined,
      project,
      undefined,
    );
    const patch =
      resolvedPatch &&
      typeof resolvedPatch === "object" &&
      !Array.isArray(resolvedPatch)
        ? (resolvedPatch as Record<string, unknown>)
        : patchObj;
    return deepMergePatch(base, patch) as Record<string, unknown>;
  };

  const introduced: string[] = [];
  for (const feature of affected) {
    if (feature.valueType !== "json") continue;
    const project = feature.project || "";
    const backed = collectFeatureConfigBackedValues(feature, {
      defaultValue: feature.defaultValue,
      rules: feature.rules,
    });
    for (const { config, patch, label } of backed) {
      if (!byKey.has(config)) continue;
      const patchObj = parsePlainJSONObject(patch);
      if (!patchObj || Object.keys(patchObj).length === 0) continue;
      const additionalProperties = configIsExtensible(
        byKey.get(getConfigSpineRootKey(config, byKey)),
        extensibleDefault,
      );
      const introducedFor = (env: string): string[] => {
        const current = shippedValue(
          config,
          patchObj,
          buildConstantValueMap(resolvables, env),
          project,
        );
        const proposed = shippedValue(
          config,
          patchObj,
          buildConstantValueMap(proposedResolvables, env),
          project,
        );
        if (!proposed) return [];
        const currentViolations = new Set(
          current
            ? collectResolvedConfigValueViolations({
                configKey: config,
                value: current,
                byKey,
                additionalProperties,
              })
            : [],
        );
        return collectResolvedConfigValueViolations({
          configKey: config,
          value: proposed,
          byKey,
          additionalProperties,
        }).filter((v) => !currentViolations.has(v));
      };
      const baseViolations = new Set(introducedFor(""));
      for (const v of baseViolations) {
        introduced.push(`feature "${feature.id}" ${label}: ${v}`);
      }
      for (const env of environments) {
        for (const v of introducedFor(env)) {
          if (!baseViolations.has(v)) {
            introduced.push(`feature "${feature.id}" ${label} [${env}]: ${v}`);
          }
        }
      }
    }
  }
  return [...new Set(introduced)];
}

// Warn (never hard-block) when publishing a constant would make a dependent
// config OR config-backed feature value violate its schema or invariants.
// Bypassable soft warning on a direct publish (?ignoreWarnings=true or
// bypassApprovalChecks).
//
// All schema-break violations a proposed constant value would introduce —
// dependent configs (per env) and config-backed feature values, combined.
async function constantSchemaBreakViolations(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string,
): Promise<string[]> {
  const [configViolations, featureViolations] = await Promise.all([
    evaluateConstantSchemaBreakConflicts(context, constant, proposedValue),
    evaluateConstantFeatureSchemaBreakConflicts(
      context,
      constant,
      proposedValue,
    ),
  ]);
  return [...configViolations, ...featureViolations];
}

// Warn (never hard-block) when publishing a constant would make a dependent
// config OR config-backed feature value violate its schema/invariants.
// - Direct publish: bypassable soft warning (?ignoreWarnings / approval-bypass).
// - Armed (deferred) fire: re-checked against the arm-time fingerprint
//   (captureConstantSchemaBreakAcknowledgment); a break not acknowledged when
//   scheduling is terminal, so a schedule that goes bad by fire time surfaces
//   rather than silently shipping.
export async function assertConstantSchemaBreakGuard(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string | undefined,
  { armed }: { armed: boolean },
  revision?: Pick<Revision, "armAcknowledgments">,
): Promise<void> {
  // Without the proposed value there's nothing to resolve-and-check; fail open
  // (this is a soft advisory, not a correctness gate).
  if (proposedValue === undefined) return;

  const violations = await constantSchemaBreakViolations(
    context,
    constant,
    proposedValue,
  );

  if (armed) {
    assertArmedSchemaBreakAcknowledged(
      violations,
      revision,
      "Publishing this constant would newly break dependent config or feature value(s)",
    );
    return;
  }

  resolveDirectSchemaBreak(
    context,
    violations,
    constant.project,
    { constantKey: constant.key },
    "Publishing this constant would make dependent config or feature value(s) violate their schema or validation rules:",
  );
}

// Arm-time fingerprint for a deferred constant publish: the breaks it would
// introduce, which the armer must acknowledge (bypassably) to schedule. The
// deferred fire re-checks against this. Returns undefined when nothing breaks.
export async function captureConstantSchemaBreakAcknowledgment(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string | undefined,
): Promise<string[] | undefined> {
  if (proposedValue === undefined) return undefined;
  const violations = await constantSchemaBreakViolations(
    context,
    constant,
    proposedValue,
  );
  if (!violations.length) return undefined;

  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: constant.project || "",
    });
  if (!override) {
    throw new SoftWarningError(
      "Scheduling this constant publish will make dependent config or feature value(s) violate their schema or validation rules:\n" +
        violations.join("\n") +
        "\nRe-submit with ignoreWarnings to acknowledge and schedule.",
      violations,
    );
  }
  return [...new Set(violations)].sort();
}

// The config-side counterpart: the violations a config's own PROPOSED value
// would introduce in its resolved shape — the check the ordinary config
// collectors skip, since they exempt `@const:`-backed fields (whose resolved
// type is only known once substituted). Resolves the proposed value with the
// CURRENT constants (this is a config publish, not a constant change), per
// environment, and diffs against the live value so only breaks this publish
// introduces are reported. Catches publishing a config whose `@const:` field
// resolves to a schema-violating value in some environment.
type ProposedConfig = Pick<
  ConfigInterface,
  "key" | "project" | "value" | "schema" | "parent" | "extends" | "extensible"
>;

export async function evaluateConfigOwnSchemaBreakConflicts(
  context: Context,
  proposed: ProposedConfig,
): Promise<string[]> {
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const resolvables = await getResolvableValues(scanContext);
  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const byKeyLive = new Map(allConfigs.map((c) => [c.key, c]));
  const live = byKeyLive.get(proposed.key);
  // No live config (a create) — creation is validated on its own path, and there
  // is no prior value to diff against. Skip.
  if (!live) return [];

  // Proposed schema/lineage drive the check; live drives the diff baseline.
  const proposedNode = { ...live, ...proposed } as ConfigInterface;
  const byKeyProposed = new Map(byKeyLive);
  byKeyProposed.set(proposed.key, proposedNode);

  // Swap the config's own value in the resolvable universe (bases synthesized as
  // `@config:` `$extends`, matching configToResolvable) so resolution reflects
  // the value being published.
  const proposedResolvables = resolvables.map((r) =>
    r.source === "config" && r.key === proposed.key
      ? {
          ...r,
          value: withConfigExtends(
            proposedNode.value,
            getConfigBaseKeys(proposedNode),
          ),
        }
      : r,
  );

  const extensibleDefault = context.org.settings?.configsExtensibleByDefault;
  const project = proposedNode.project || "";
  const liveAdditional = configIsExtensible(
    byKeyLive.get(getConfigSpineRootKey(proposed.key, byKeyLive)),
    extensibleDefault,
  );
  const proposedAdditional = configIsExtensible(
    byKeyProposed.get(getConfigSpineRootKey(proposed.key, byKeyProposed)),
    extensibleDefault,
  );

  const introducedFor = (env: string): string[] => {
    const current = resolveConfigConcreteValue(
      proposed.key,
      buildConstantValueMap(resolvables, env),
      project,
    );
    const next = resolveConfigConcreteValue(
      proposed.key,
      buildConstantValueMap(proposedResolvables, env),
      project,
    );
    if (!next) return [];
    const currentViolations = new Set(
      current
        ? collectResolvedConfigValueViolations({
            configKey: proposed.key,
            value: current,
            byKey: byKeyLive,
            additionalProperties: liveAdditional,
          })
        : [],
    );
    return collectResolvedConfigValueViolations({
      configKey: proposed.key,
      value: next,
      byKey: byKeyProposed,
      additionalProperties: proposedAdditional,
    }).filter((v) => !currentViolations.has(v));
  };

  const introduced: string[] = [];
  const baseViolations = new Set(introducedFor(""));
  for (const v of baseViolations) introduced.push(v);
  for (const env of getEnvironmentIdsFromOrg(context.org)) {
    for (const v of introducedFor(env)) {
      if (!baseViolations.has(v)) introduced.push(`[${env}] ${v}`);
    }
  }
  return [...new Set(introduced)];
}

// Warn when publishing a config would make its own resolved value violate its
// schema/invariants once `@const:` refs are substituted — the config-side analog
// of assertConstantSchemaBreakGuard. Direct = bypassable soft warning; armed =
// re-checked against the arm-time fingerprint (terminal on a newly-introduced
// break).
export async function assertConfigSchemaBreakGuard(
  context: Context,
  proposed: ProposedConfig,
  { armed }: { armed: boolean },
  revision?: Pick<Revision, "armAcknowledgments">,
): Promise<void> {
  const violations = await evaluateConfigOwnSchemaBreakConflicts(
    context,
    proposed,
  );

  if (armed) {
    assertArmedSchemaBreakAcknowledged(
      violations,
      revision,
      "Publishing this config would newly break its own resolved value",
    );
    return;
  }

  resolveDirectSchemaBreak(
    context,
    violations,
    proposed.project,
    { configKey: proposed.key },
    "Publishing this config would make its resolved value violate its schema or validation rules:",
  );
}

// Arm-time fingerprint for a deferred config publish (see the constant analog).
export async function captureConfigSchemaBreakAcknowledgment(
  context: Context,
  proposed: ProposedConfig,
): Promise<string[] | undefined> {
  const violations = await evaluateConfigOwnSchemaBreakConflicts(
    context,
    proposed,
  );
  if (!violations.length) return undefined;

  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: proposed.project || "",
    });
  if (!override) {
    throw new SoftWarningError(
      "Scheduling this config publish will make its resolved value violate its schema or validation rules:\n" +
        violations.join("\n") +
        "\nRe-submit with ignoreWarnings to acknowledge and schedule.",
      violations,
    );
  }
  return [...new Set(violations)].sort();
}
