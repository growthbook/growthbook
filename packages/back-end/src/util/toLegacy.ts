import {
  FeatureInterface,
  FeatureRule,
  V1FeatureEnvironment,
  V1FeatureInterface,
  V1FeatureRevisionInterface,
  V1FeatureRule,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";

// ---------------------------------------------------------------------------
// v2 -> v1 down-conversion (toLegacy)
// ---------------------------------------------------------------------------
//
// Mirrors the v1 -> v2 JIT chokepoints (buildFeatureInterface,
// buildFeatureRevisionInterface). These adapters explode the v2 top-level
// `rules: FeatureRule[]` into the v1 per-env shape so the v1 REST API layer
// (/api/v1) can keep its existing contract while the internal model is v2.
//
// Round-trip contract:
//   - `uid` is preserved on every exploded copy. `V1FeatureRule` is a zod
//     `.passthrough()` schema, so the uid survives (de)serialization even
//     though v1 clients don't know the field exists. Clients that do know
//     about it (ramp targets, audit log diff renderers) get stable refs.
//   - The reverse direction — reconstituting v2 from an incoming v1 PUT —
//     is handled by `legacyToV2Feature` / `legacyToV2Revision` (Phase 6a).
//     That adapter matches by uid first, falling back to (id, env). Together
//     with these exploders, the full round-trip `legacyToV2(toLegacy(x)) ≡ x`
//     is the key stability invariant for frequent v1 writers.
//   - These adapters do NOT go back through `flattenV1ToV2Rules` on read.
//     The output is a REST response body, not on-disk data. The JIT flatten
//     still generates uids from the legacy-id formula because it only ever
//     sees v0/v1 docs that lack uids.
// ---------------------------------------------------------------------------

/**
 * Down-convert one v2 FeatureRule to a v1 rule. Strips the v2-only scope
 * fields `allEnvironments` and `environments`; preserves every other field,
 * including `uid`.
 */
export function toLegacyRule(rule: FeatureRule): V1FeatureRule {
  const {
    allEnvironments: _a,
    environments: _e,
    ...v1
  } = rule as FeatureRule & {
    allEnvironments?: boolean;
    environments?: string[];
  };
  return v1 as unknown as V1FeatureRule;
}

/**
 * Compute the per-env footprint for a v2 rule, filtered to the org's
 * applicable envs for the feature. `allEnvironments: true` expands to every
 * applicable env; env-specific rules intersect their `environments` array
 * with the applicable set. Rules with no overlap return [].
 */
function ruleFootprint(rule: FeatureRule, applicableEnvs: string[]): string[] {
  if (rule.allEnvironments) return applicableEnvs;
  const applicableSet = new Set(applicableEnvs);
  return (rule.environments || []).filter((e) => applicableSet.has(e));
}

/**
 * Project a v2 `FeatureInterface` to the v1 on-disk shape consumed by the
 * `/api/v1` REST surface: rules move from the top-level array back into
 * `environmentSettings[env].rules`, with uids preserved.
 *
 * Per-env rule order: for each env we emit rules in the order they appear in
 * `feature.rules`, filtered to that env's footprint. That preserves v2's
 * global rule order as a per-env sub-ordering (stable partial-order projection).
 *
 * environmentSettings policy: we emit entries for the union of
 * `(applicableEnvs, existing envSettings keys)`. This preserves any existing
 * env state (enabled flag, prerequisites) for envs the v2 doc already
 * recorded, even envs that are no longer applicable to the feature's project
 * — clients may still render them as disabled/archived.
 */
export function toLegacyFeature(
  feature: FeatureInterface,
  orgEnvs: Environment[],
): V1FeatureInterface {
  const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);
  const existing = feature.environmentSettings || {};

  const rulesByEnv: Record<string, V1FeatureRule[]> = {};
  for (const env of applicableEnvs) rulesByEnv[env] = [];

  for (const rule of feature.rules || []) {
    const envs = ruleFootprint(rule, applicableEnvs);
    if (envs.length === 0) continue;
    const v1Rule = toLegacyRule(rule);
    for (const env of envs) {
      if (!rulesByEnv[env]) rulesByEnv[env] = [];
      rulesByEnv[env].push(v1Rule);
    }
  }

  // Preserve existing env state (enabled, prerequisites) and attach the
  // computed rule list. Cover both applicable envs and any envs already
  // present in envSettings (so disabled/archived envs round-trip cleanly).
  const envSettings: Record<string, V1FeatureEnvironment> = {};
  const allEnvIds = new Set<string>([
    ...applicableEnvs,
    ...Object.keys(existing),
  ]);
  for (const env of allEnvIds) {
    const existingEnv = existing[env];
    envSettings[env] = {
      enabled: existingEnv?.enabled ?? false,
      ...(existingEnv?.prerequisites
        ? { prerequisites: existingEnv.prerequisites }
        : {}),
      rules: rulesByEnv[env] ?? [],
    };
  }

  // Strip the v2 top-level rules array from the output — v1 docs don't have
  // it (except as v0 crust, which we never emit).
  const {
    rules: _v2Rules,
    environmentSettings: _oldEnvSettings,
    ...rest
  } = feature;
  return {
    ...rest,
    environmentSettings: envSettings,
  } as V1FeatureInterface;
}

/**
 * Project a v2 `FeatureRevisionInterface` to the v1 revision shape: rules
 * become a `Record<env, V1FeatureRule[]>` keyed by environment. Everything
 * else on the revision is copied through unchanged.
 *
 * `featureProject` drives the applicable-env filter identically to
 * `toLegacyFeature`. Callers that don't have the parent feature in scope
 * should pass undefined; they'll get every org env in the record, which is a
 * safe superset.
 */
export function toLegacyRevision(
  revision: FeatureRevisionInterface,
  orgEnvs: Environment[],
  featureProject?: string,
): V1FeatureRevisionInterface {
  const applicableEnvs = getApplicableEnvIds(orgEnvs, featureProject);

  const rulesByEnv: Record<string, V1FeatureRule[]> = {};
  for (const env of applicableEnvs) rulesByEnv[env] = [];

  for (const rule of revision.rules || []) {
    const envs = ruleFootprint(rule, applicableEnvs);
    if (envs.length === 0) continue;
    const v1Rule = toLegacyRule(rule);
    for (const env of envs) {
      if (!rulesByEnv[env]) rulesByEnv[env] = [];
      rulesByEnv[env].push(v1Rule);
    }
  }

  const { rules: _v2Rules, ...rest } = revision;
  return {
    ...rest,
    rules: rulesByEnv,
  } as V1FeatureRevisionInterface;
}
