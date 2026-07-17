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
import { FeatureInterface } from "shared/types/feature";
import { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import {
  getResolvableValues,
  ResolvableValue,
} from "back-end/src/services/resolvableValues";
import {
  getArmAcknowledgment,
  type ArmGuardId,
} from "back-end/src/services/armGuards";
import {
  resolvableDependencyClosure,
  featuresAffectedByResolvable,
} from "back-end/src/services/constants";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
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

// The breaks present at a deferred fire that weren't acknowledged when the
// publish was scheduled — i.e. NEW breaks introduced since arming. Membership,
// so order/dedup of the two lists doesn't matter. Pure (exported for tests).
export function unacknowledgedSchemaBreakViolations(
  currentViolations: string[],
  acknowledged: string[] | null | undefined,
): string[] {
  const ack = new Set(acknowledged ?? []);
  return currentViolations.filter((v) => !ack.has(v));
}

// Decide an ARMED (deferred) fire against the arm-time fingerprint: a violation
// not acknowledged when the publish was scheduled is a NEW break introduced
// since — the deferred publish is terminal (re-open + re-confirm). Acknowledged
// breaks stand (the armer already accepted them).
function assertArmedSchemaBreakAcknowledged(
  violations: string[],
  revision: Pick<Revision, "armAcknowledgments"> | undefined,
  entityMessage: string,
): void {
  const unacknowledged = unacknowledgedSchemaBreakViolations(
    violations,
    revision && getArmAcknowledgment(revision, SCHEMA_BREAK),
  );
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

// A per-environment ConstantValueMap getter that builds each env's map at most
// once (a map is O(resolvables); without memoization it was rebuilt once per
// affected config/feature, i.e. O(entities × envs × resolvables) on large orgs).
type EnvMapGetter = (env: string) => ConstantValueMap;
function memoizedEnvMaps(resolvables: ResolvableValue[]): EnvMapGetter {
  const cache = new Map<string, ConstantValueMap>();
  return (env) => {
    let map = cache.get(env);
    if (!map) {
      map = buildConstantValueMap(resolvables, env);
      cache.set(env, map);
    }
    return map;
  };
}

// Scope introduced violations to the environments where they actually occur:
// present in EVERY environment → reported once untagged; a strict subset →
// tagged per environment. A violation present only under base values (every
// live environment avoids it via a per-env override) serves nowhere, so it is
// dropped rather than reported as if it broke everywhere — the base value only
// matters where an environment inherits it. With no environments the base
// pass is authoritative.
function collectEnvScopedViolations(
  environments: string[],
  introducedFor: (env: string) => string[],
  format: (violation: string, env: string | null) => string,
): string[] {
  if (!environments.length) {
    return introducedFor("").map((v) => format(v, null));
  }
  const perEnv = environments.map((env) => ({
    env,
    violations: new Set(introducedFor(env)),
  }));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { violations } of perEnv) {
    for (const v of violations) {
      if (seen.has(v)) continue;
      seen.add(v);
      const envs = perEnv.filter((p) => p.violations.has(v)).map((p) => p.env);
      if (envs.length === environments.length) {
        out.push(format(v, null));
      } else {
        for (const env of envs) out.push(format(v, env));
      }
    }
  }
  return out;
}

// The resolvable universe with one constant's value + per-env values swapped to
// the proposed ones — the "after this publish" world the diff compares against.
function swapConstantValue(
  resolvables: ResolvableValue[],
  constantKey: string,
  proposedValue: string | undefined,
  proposedEnvironmentValues: Record<string, string> | undefined,
): ResolvableValue[] {
  return resolvables.map((r) =>
    r.source === "constant" && r.key === constantKey
      ? {
          ...r,
          value: proposedValue ?? "",
          // A per-environment value change lives here, not in the base value —
          // swap the whole map so env-specific resolution reflects it.
          environmentValues: proposedEnvironmentValues ?? r.environmentValues,
        }
      : r,
  );
}

// Current + proposed per-env map getters, shared across the config and feature
// checks of one constant publish so the maps are built once, not per check.
type ConstantEnvMaps = { current: EnvMapGetter; proposed: EnvMapGetter };

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
// its environment. Pure (loaded data in, violations out) — the caller loads the
// collections once and shares `envMaps` with the feature check.
export function collectConstantConfigBreaks({
  resolvables,
  allConfigs,
  environments,
  extensibleDefault,
  constantKey,
  proposedValue,
  proposedEnvironmentValues,
  envMaps,
}: {
  resolvables: ResolvableValue[];
  allConfigs: ConfigInterface[];
  environments: string[];
  extensibleDefault: boolean | undefined;
  constantKey: string;
  proposedValue: string | undefined;
  proposedEnvironmentValues?: Record<string, string>;
  // Shared per-env maps (built once for the config + feature checks of one
  // publish). Omit to build them locally.
  envMaps?: ConstantEnvMaps;
}): string[] {
  const affectedConfigKeys = [
    ...resolvableDependencyClosure(resolvables, "constant", constantKey),
  ]
    .filter((t) => t.startsWith(CONFIG_PREFIX))
    .map((t) => t.slice(CONFIG_PREFIX.length));
  if (!affectedConfigKeys.length) return [];

  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  // Per environment, buildConstantValueMap picks that env's constant values, so
  // resolution reflects what actually ships there. The proposed map swaps only
  // the changed constant, so the diff isolates the breaks this change introduces.
  const currentMapFor = envMaps?.current ?? memoizedEnvMaps(resolvables);
  const proposedMapFor =
    envMaps?.proposed ??
    memoizedEnvMaps(
      swapConstantValue(
        resolvables,
        constantKey,
        proposedValue,
        proposedEnvironmentValues,
      ),
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
      currentMapFor(env),
      project,
    );
    const proposed = resolveConfigConcreteValue(
      key,
      proposedMapFor(env),
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

  const introduced: string[] = [];
  for (const key of affectedConfigKeys) {
    const cfg = byKey.get(key);
    if (!cfg) continue;
    const additionalProperties = configIsExtensible(
      byKey.get(getConfigSpineRootKey(key, byKey)),
      extensibleDefault,
    );
    const project = cfg.project || "";

    introduced.push(
      ...collectEnvScopedViolations(
        environments,
        (env) => introducedFor(key, env, project, additionalProperties),
        (v, env) =>
          env === null
            ? `config "${key}": ${v}`
            : `config "${key}" [${env}]: ${v}`,
      ),
    );
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
export function collectConstantFeatureBreaks({
  resolvables,
  features,
  allConfigs,
  environments,
  extensibleDefault,
  constantKey,
  proposedValue,
  proposedEnvironmentValues,
  envMaps,
}: {
  resolvables: ResolvableValue[];
  features: FeatureInterface[];
  allConfigs: ConfigInterface[];
  environments: string[];
  extensibleDefault: boolean | undefined;
  constantKey: string;
  proposedValue: string | undefined;
  proposedEnvironmentValues?: Record<string, string>;
  envMaps?: ConstantEnvMaps;
}): string[] {
  const affected = featuresAffectedByResolvable(
    resolvables,
    features,
    "constant",
    constantKey,
  );
  if (!affected.length) return [];

  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  const currentMapFor = envMaps?.current ?? memoizedEnvMaps(resolvables);
  const proposedMapFor =
    envMaps?.proposed ??
    memoizedEnvMaps(
      swapConstantValue(
        resolvables,
        constantKey,
        proposedValue,
        proposedEnvironmentValues,
      ),
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
          currentMapFor(env),
          project,
        );
        const proposed = shippedValue(
          config,
          patchObj,
          proposedMapFor(env),
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
      introduced.push(
        ...collectEnvScopedViolations(environments, introducedFor, (v, env) =>
          env === null
            ? `feature "${feature.id}" ${label}: ${v}`
            : `feature "${feature.id}" ${label} [${env}]: ${v}`,
        ),
      );
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
// dependent configs (per env) and config-backed feature values, combined. Loads
// each collection ONCE and shares the per-env maps across both checks (the two
// used to reload configs/constants independently and rebuild maps per entity).
async function constantSchemaBreakViolations(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string,
  proposedEnvironmentValues?: Record<string, string>,
): Promise<string[]> {
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const [resolvables, features] = await Promise.all([
    getResolvableValues(scanContext),
    getAllFeaturesWithoutEditorFields(scanContext),
  ]);
  const allConfigs = await scanContext.models.configs.getAllForReconcile();

  const envMaps: ConstantEnvMaps = {
    current: memoizedEnvMaps(resolvables),
    proposed: memoizedEnvMaps(
      swapConstantValue(
        resolvables,
        constant.key,
        proposedValue,
        proposedEnvironmentValues,
      ),
    ),
  };
  const shared = {
    resolvables,
    allConfigs,
    environments: getEnvironmentIdsFromOrg(context.org),
    extensibleDefault: context.org.settings?.configsExtensibleByDefault,
    constantKey: constant.key,
    proposedValue,
    proposedEnvironmentValues,
    envMaps,
  };
  return [
    ...collectConstantConfigBreaks(shared),
    ...collectConstantFeatureBreaks({ ...shared, features }),
  ];
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
  proposedEnvironmentValues?: Record<string, string>,
): Promise<void> {
  // Without the proposed value there's nothing to resolve-and-check; fail open
  // (this is a soft advisory, not a correctness gate).
  if (proposedValue === undefined) return;

  const violations = await constantSchemaBreakViolations(
    context,
    constant,
    proposedValue,
    proposedEnvironmentValues,
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
  proposedEnvironmentValues?: Record<string, string>,
): Promise<string[] | undefined> {
  if (proposedValue === undefined) return undefined;
  const violations = await constantSchemaBreakViolations(
    context,
    constant,
    proposedValue,
    proposedEnvironmentValues,
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
  return collectConfigOwnBreaks({
    resolvables,
    allConfigs,
    environments: getEnvironmentIdsFromOrg(context.org),
    extensibleDefault: context.org.settings?.configsExtensibleByDefault,
    proposed,
  });
}

// Pure core of evaluateConfigOwnSchemaBreakConflicts (loaded data in, violations
// out) — exported for unit testing. See the wrapper above for semantics.
export function collectConfigOwnBreaks({
  resolvables,
  allConfigs,
  environments,
  extensibleDefault,
  proposed,
}: {
  resolvables: ResolvableValue[];
  allConfigs: ConfigInterface[];
  environments: string[];
  extensibleDefault: boolean | undefined;
  proposed: ProposedConfig;
}): string[] {
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

  const introduced = collectEnvScopedViolations(
    environments,
    introducedFor,
    (v, env) => (env === null ? v : `[${env}] ${v}`),
  );
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
