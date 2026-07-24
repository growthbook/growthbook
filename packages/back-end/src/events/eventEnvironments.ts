import isEqual from "lodash/isEqual";
import { ApiFeature } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { getApiFeatureAllEnvs, getApiFeatureEnabledEnvs } from "shared/util";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";

// ─────────────────────────────────────────────────────────────────────────────
// Event `environments` semantics — one meaning, everywhere:
//
//   "The environments affected by the change described by this event."
//
// - Live-state events (`feature.updated`, …): the environments whose
//   effective configuration actually changed in the before/after transition.
//   Feature-wide keys (defaultValue, prerequisites, …) affect every env.
// - Draft lifecycle events (`feature.revision.*`): the environments the
//   revision's proposed changes would affect — the union of its rule scopes,
//   resolved at dispatch time (`allEnvironments: true` expanded against the
//   org's project-filtered env list) so the persisted payload is a
//   point-in-time snapshot.
// - An empty array means the event has no environment-scoped impact; such
//   events are only delivered to subscriptions without an environment filter.
//
// All producers must derive the routing field through the helpers in this
// module so the semantics can't fork per event family again.
// ─────────────────────────────────────────────────────────────────────────────

// Some of the feature keys that change affect all enabled environments
export const RELEVANT_KEYS_FOR_ALL_ENVS: (keyof ApiFeature)[] = [
  "archived",
  "defaultValue",
  "prerequisites",
  "project",
  "valueType",
];

/**
 * Environments whose effective configuration differs between the previous
 * and current snapshots. Feature-wide keys expand to every env.
 */
export function getChangedApiFeatureEnvironments(
  previous: ApiFeature,
  current: ApiFeature,
): string[] {
  const allEnvs = Array.from(
    new Set([
      ...Object.keys(previous.environments),
      ...Object.keys(current.environments),
    ]),
  );

  if (
    RELEVANT_KEYS_FOR_ALL_ENVS.some((k) => !isEqual(previous[k], current[k]))
  ) {
    // Some of the relevant keys for all environments has changed.
    return allEnvs;
  }

  // Manual environment filtering
  const changedEnvironments = new Set<string>();

  // Add in environments if their specific settings changed
  allEnvs.forEach((env) => {
    const previousEnvSettings = previous.environments[env];
    const currentEnvSettings = current.environments[env];

    // If the environment is disabled both before and after the change, ignore changes
    if (!previousEnvSettings?.enabled && !currentEnvSettings?.enabled) {
      return;
    }

    // the environment has changed
    if (!isEqual(previousEnvSettings, currentEnvSettings)) {
      changedEnvironments.add(env);
    }
  });

  return Array.from(changedEnvironments);
}

/**
 * Affected environments for live-state feature events.
 *
 * - `updated` (previous snapshot exists): the envs whose effective config
 *   actually changed in the transition.
 * - `created`: every env the feature is live in (enabled envs).
 * - `deleted`: every configured env — the deletion is relevant wherever the
 *   feature existed, enabled or not.
 */
export function deriveLiveFeatureEventEnvironments({
  previous,
  current,
  deleted,
}: {
  previous?: ApiFeature;
  current: ApiFeature;
  deleted?: boolean;
}): string[] {
  if (previous !== undefined) {
    return getChangedApiFeatureEnvironments(previous, current);
  }
  return deleted
    ? getApiFeatureAllEnvs(current)
    : getApiFeatureEnabledEnvs(current);
}

/**
 * Affected environments for `feature.revision.*` events: the envs the
 * revision's proposed changes would affect. Precedence:
 * `overrideEnvironments` → union of rule scopes on `revision.rules` →
 * feature's configured envs (for env-agnostic changes like default value).
 * `allEnvironments: true` rules expand to the feature's project-filtered
 * applicable envs — resolved here, at dispatch time, so the persisted payload
 * snapshots the expansion. Result is filtered to envs applicable to the
 * feature's project.
 */
export function deriveRevisionEventEnvironments(
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  orgEnvs: Environment[],
  overrideEnvironments?: string[],
): string[] {
  // Union of primary + targeting projects (all envs when targeting all projects).
  const featureProjects = [
    feature.project,
    ...(feature.targetingProjects ?? []),
  ].filter((p): p is string => !!p);
  const inProject = (envId: string) => {
    const envDef = orgEnvs.find((e) => e.id === envId);
    if (!envDef || !envDef.projects?.length) return true;
    if (feature.targetingAllProjects || !featureProjects.length) return true;
    return featureProjects.some((p) => envDef.projects?.includes(p));
  };

  let rawEnvironments: string[];
  if (overrideEnvironments !== undefined) {
    rawEnvironments = overrideEnvironments;
  } else if (Array.isArray(revision.rules) && revision.rules.length > 0) {
    // Union of each rule's scope. `allEnvironments: true` expands to the
    // feature's applicable envs, not every org env. Nullish slots (sparse
    // pre-v2 docs) are skipped defensively — JIT-boundary filters already
    // drop them, but this loop fans out into event dispatch so a guard here
    // protects against any future regression.
    const applicableEnvs = getApplicableEnvIds(orgEnvs, feature);
    const declared = new Set<string>();
    for (const rule of revision.rules) {
      if (rule == null || typeof rule !== "object") continue;
      if (rule.allEnvironments) {
        applicableEnvs.forEach((e) => declared.add(e));
      } else if (rule.environments?.length) {
        rule.environments.forEach((e) => declared.add(e));
      }
    }
    rawEnvironments = [...declared];
  } else {
    rawEnvironments = Object.keys(feature.environmentSettings ?? {});
  }

  return rawEnvironments.filter(inProject);
}
