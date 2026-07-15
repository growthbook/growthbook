import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import {
  collectResolvedConfigValueViolations,
  configIsExtensible,
  getConfigSpineRootKey,
  parsePlainJSONObject,
  deepMergePatch,
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantValueMap,
} from "shared/sdk-versioning";
import { ConstantInterface } from "shared/types/constant";
import type { Context } from "back-end/src/models/BaseModel";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import {
  resolvableDependencyClosure,
  featuresAffectedByResolvable,
} from "back-end/src/services/constants";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { collectFeatureConfigBackedValues } from "back-end/src/services/configValidation";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { SoftWarningError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

const CONFIG_PREFIX = "config:";

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
// Deferred (armed) publishes are intentionally skipped in this first cut: a
// scheduled / auto-publish-on-approval fire has no request to acknowledge
// against, and blocking it terminally would strand schedules. Arm-time capture +
// deferred re-check (mirroring the experiment guard) is a documented follow-on.
export async function assertConstantSchemaBreakGuard(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string | undefined,
  { armed }: { armed: boolean },
): Promise<void> {
  if (armed) return;
  // Without the proposed value there's nothing to resolve-and-check; fail open
  // (this is a soft advisory, not a correctness gate).
  if (proposedValue === undefined) return;

  const [configViolations, featureViolations] = await Promise.all([
    evaluateConstantSchemaBreakConflicts(context, constant, proposedValue),
    evaluateConstantFeatureSchemaBreakConflicts(
      context,
      constant,
      proposedValue,
    ),
  ]);
  const violations = [...configViolations, ...featureViolations];
  if (!violations.length) return;

  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: constant.project || "",
    });
  if (override) {
    logger.info(
      { constantKey: constant.key, userId: context.userId, violations },
      "Constant schema-break guard overridden on a direct publish",
    );
    return;
  }

  throw new SoftWarningError(
    "Publishing this constant would make dependent config or feature value(s) violate their schema or validation rules:\n" +
      violations.join("\n"),
    violations,
  );
}
