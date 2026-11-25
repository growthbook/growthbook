import { ApiFeature } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import {
  getApiFeatureAllEnvs,
  getApiFeatureEnabledEnvs,
  getApplicableEnvIds,
} from "shared/util";

// ─────────────────────────────────────────────────────────────────────────────
// Event `environments` semantics — one meaning, everywhere:
//
//   "The environments affected by the change described by this event."
//
// - Live-state events (`feature.updated`, …): the environments whose
//   effective configuration actually changed in the before/after transition.
//   Feature-wide keys (defaultValue, prerequisites, …) affect every env the
//   feature is enabled in.
// - Draft lifecycle events (`feature.revision.*`): the environments the
//   revision's proposed changes would affect — the union of its rule scopes,
//   resolved at dispatch time (`allEnvironments: true` expanded against the
//   org's project-filtered env list) so the persisted payload is a
//   point-in-time snapshot.
// - An empty array means the event has no environment-scoped impact; such
//   events are only delivered to subscriptions without an environment filter.
//   A producer whose change has no environment BINDING but is felt in all of them
//   — a Constant's base value, a base Config — must therefore resolve the reach
//   ITSELF and emit those environments, because [] here means "nothing", not
//   "everything". The delivery filter cannot tell the two apart, which is why it
//   must not try (see handlers/utils.ts).
//
// All producers must derive the routing field through the helpers in this
// module, or `getChangedFeatureEnvironments` for feature updates, so the
// semantics can't fork per event family again.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Affected environments for created and deleted feature events; updates use
 * `getChangedFeatureEnvironments`, as the SDK cache refresh does.
 *
 * - `created`: every env the feature is live in (enabled envs).
 * - `deleted`: every configured env — the deletion is relevant wherever the
 *   feature existed, enabled or not.
 */
export function deriveLiveFeatureEventEnvironments({
  current,
  deleted,
}: {
  current: ApiFeature;
  deleted?: boolean;
}): string[] {
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
