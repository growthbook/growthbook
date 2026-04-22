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
import {
  getApplicableEnvIds,
  ruleFootprint,
} from "back-end/src/util/flattenRules";

// v2 -> v1 down-conversion for the /api/v1 REST surface. Mirrors the
// v1 -> v2 JIT chokepoints. Rule ids are preserved verbatim (including any
// `__<env>` suffix) so clients can round-trip them back on PUT/DELETE;
// reverse conversion flows through `flattenV1ToV2Rules`, which merges/splits
// by content so the cycle is byte-stable.

// Strip v2-only scope fields. Preserves id verbatim (see file header).
export function toLegacyRule(rule: FeatureRule): V1FeatureRule {
  const {
    allEnvironments: _a,
    environments: _e,
    ...rest
  } = rule as FeatureRule & {
    allEnvironments?: boolean;
    environments?: string[];
  };
  return rest as unknown as V1FeatureRule;
}

/**
 * v2 → v1 feature projection: top-level rules move back into
 * `environmentSettings[env].rules`. Per-env rule order preserves v2's global
 * order (stable partial-order projection). Entries are emitted for the union
 * of (applicableEnvs ∪ existing envSettings keys) so disabled/archived envs
 * round-trip cleanly.
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
 * v2 → v1 revision projection: rules become `Record<env, V1FeatureRule[]>`.
 * `featureProject` scopes the env set; omit it for a safe superset (every
 * org env).
 */
export function toLegacyRevision(
  revision: FeatureRevisionInterface,
  orgEnvs: Environment[],
  featureProject?: string,
): V1FeatureRevisionInterface {
  const applicableEnvs = getApplicableEnvIds(orgEnvs, featureProject);

  // Union with `environmentsEnabled` keys so v1 clients iterating
  // `Object.keys(revision.rules)` see disabled/archived envs the revision
  // still tracks. `ruleFootprint` limits rule assignment to applicable envs.
  const envIds = new Set<string>([
    ...applicableEnvs,
    ...Object.keys(revision.environmentsEnabled ?? {}),
  ]);

  const rulesByEnv: Record<string, V1FeatureRule[]> = {};
  for (const env of envIds) rulesByEnv[env] = [];

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
