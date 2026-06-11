import isEqual from "lodash/isEqual";
import { ApiFeature } from "shared/validators";
import { EventEnvironments } from "shared/types/events/base-types";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { getApiFeatureAllEnvs, getApiFeatureEnabledEnvs } from "shared/util";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";

// ─────────────────────────────────────────────────────────────────────────────
// Event `environments` semantics — one semantic with a refinement.
//
// Every event carries a single meaning for its environments routing field:
// "the environments this event is relevant to". Two facts feed it:
//
// - `applicable` — where the object operates. The universal computation,
//   valid for every event. Resolved at dispatch time (rule scopes expanded
//   against the org's project-filtered env list) so the stored payload is a
//   point-in-time snapshot that later env-config changes can't rewrite.
// - `changed` — where behavior actually moved. A *refinement* of
//   `applicable`, only definable when a before/after pair exists (live-state
//   transitions). It is pure denormalization — consumers can re-derive it
//   from `object` / `previous_attributes` — and exists for routing precision.
//
// The routing field is always derived by `routingEnvironments`:
// `changed ?? applicable ?? []`. Both facts are also persisted on the payload
// as `data.environments` so consumers don't have to reverse-engineer which
// computation produced the routing value.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the top-level routing field from the environment facts:
 * `changed` when a transition exists, else `applicable`, else `[]`
 * (not environment-scoped).
 */
export function routingEnvironments(facts: EventEnvironments): string[] {
  return facts.changed ?? facts.applicable ?? [];
}

// Some of the feature keys that change affect all enabled environments
export const RELEVANT_KEYS_FOR_ALL_ENVS: (keyof ApiFeature)[] = [
  "archived",
  "defaultValue",
  "prerequisites",
  "project",
  "valueType",
];

/**
 * `changed` fact for live feature transitions: environments whose effective
 * configuration differs between the previous and current snapshots.
 * Feature-wide keys (defaultValue, prerequisites, …) expand to every env.
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
 * Environment facts for live-state feature events (created/updated/deleted).
 *
 * `applicable`: enabled envs for created/updated; every configured env for
 * deleted (the deletion is relevant wherever the feature *was* live).
 * `changed`: only when a previous snapshot exists (transitions).
 *
 * Routing derivation (`routingEnvironments`) preserves the historical
 * behavior exactly: created → enabled envs, deleted → all envs,
 * updated → changed envs.
 */
export function deriveLiveFeatureEventEnvironments({
  previous,
  current,
  deleted,
}: {
  previous?: ApiFeature;
  current: ApiFeature;
  deleted?: boolean;
}): EventEnvironments {
  const applicable = deleted
    ? getApiFeatureAllEnvs(current)
    : getApiFeatureEnabledEnvs(current);
  if (previous === undefined) {
    return { applicable };
  }
  return {
    applicable,
    changed: getChangedApiFeatureEnvironments(previous, current),
  };
}

/**
 * `applicable` fact for `feature.revision.*` events (no live state changes,
 * so no `changed` refinement exists). Precedence: `overrideEnvironments` →
 * union of rule scopes on `revision.rules` → feature's configured envs.
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
  const featureProject = feature.project;
  const inProject = (envId: string) => {
    const envDef = orgEnvs.find((e) => e.id === envId);
    return (
      !envDef ||
      !envDef.projects?.length ||
      !featureProject ||
      envDef.projects.includes(featureProject)
    );
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
    const applicableEnvs = getApplicableEnvIds(orgEnvs, featureProject);
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
