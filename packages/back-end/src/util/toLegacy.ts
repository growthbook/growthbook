import omit from "lodash/omit";
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

// v2 -> v1 down-conversion for the /api/v1 REST surface. Rule ids round-trip
// verbatim (including `__<env>` migration suffixes); the reverse flows
// through `flattenV1ToV2Rules`, which merges by content for a byte-stable
// cycle.

// Strip v2-only scope fields; id is preserved verbatim.
export function toLegacyRule(rule: FeatureRule): V1FeatureRule {
  return omit(rule, [
    "allEnvironments",
    "environments",
  ]) as unknown as V1FeatureRule;
}

/**
 * Bucket a flat v2 rules array into the per-env `Record<env, T[]>` shape v1
 * surfaces expect. Each rule lands in every env in its
 * `ruleFootprint(rule, applicableEnvs)`; empty-footprint rules (pending
 * no-env rules, or rules whose envs are all non-applicable) are dropped.
 *
 * `seedEnvs` (default: `applicableEnvs`) is the env key set guaranteed to
 * appear in the output. Pass an explicit union when extra envs (e.g.
 * disabled/archived ones the doc still tracks) must be emitted with empty
 * rule arrays.
 *
 * Shared chokepoint for every v2→v1 bucketing call site (`toLegacyFeature`,
 * `toLegacyRevision`, `revisionToApiInterface`, `getApiFeatureObj`); the
 * only variation across callers is the per-rule transform.
 */
export function bucketRulesByEnv<T>(
  rules: FeatureRule[] | undefined,
  applicableEnvs: string[],
  transform: (rule: FeatureRule) => T,
  seedEnvs?: Iterable<string>,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const env of seedEnvs ?? applicableEnvs) out[env] = [];
  if (!rules) return out;
  for (const rule of rules) {
    const envs = ruleFootprint(rule, applicableEnvs);
    if (envs.length === 0) continue;
    const transformed = transform(rule);
    for (const env of envs) {
      if (!out[env]) out[env] = [];
      out[env].push(transformed);
    }
  }
  return out;
}

// v2 → v1 feature projection: rules fan back out into
// `environmentSettings[env].rules`. envSettings entries emit for
// `applicableEnvs ∪ existing keys` so disabled/archived envs round-trip.
export function toLegacyFeature(
  feature: FeatureInterface,
  orgEnvs: Environment[],
): V1FeatureInterface {
  const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);
  const existing = feature.environmentSettings || {};

  const rulesByEnv = bucketRulesByEnv(
    feature.rules,
    applicableEnvs,
    toLegacyRule,
  );

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

  return {
    ...omit(feature, ["rules", "environmentSettings"]),
    environmentSettings: envSettings,
  } as V1FeatureInterface;
}

// v2 → v1 revision projection. Omit `featureProject` for a safe superset
// (every org env).
export function toLegacyRevision(
  revision: FeatureRevisionInterface,
  orgEnvs: Environment[],
  featureProject?: string,
): V1FeatureRevisionInterface {
  const applicableEnvs = getApplicableEnvIds(orgEnvs, featureProject);

  // Seed with `applicableEnvs ∪ environmentsEnabled` keys so v1 clients
  // iterating `Object.keys(rules)` see disabled/archived envs the revision
  // still tracks. Assignment itself stays gated on `applicableEnvs`.
  const seedEnvs = new Set<string>([
    ...applicableEnvs,
    ...Object.keys(revision.environmentsEnabled ?? {}),
  ]);

  const rulesByEnv = bucketRulesByEnv(
    revision.rules,
    applicableEnvs,
    toLegacyRule,
    seedEnvs,
  );

  return {
    ...omit(revision, ["rules"]),
    rules: rulesByEnv,
  } as V1FeatureRevisionInterface;
}
