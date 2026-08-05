// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import { isEqual } from "lodash";
import type { FeatureRule } from "shared/types/feature";
import { getRulesForEnvironment } from "../util/index";
import type { MergeResultChanges } from "../util/features";

// The environment footprint of publishing a Feature Flag draft: which
// environments the change actually reaches, and so which ones authority is
// required in.
//
// One function because the two callers kept disagreeing. The endpoints derived
// the footprint from the merge result; the Publish and Revert controls derived
// their own from the revision, and theirs answered a narrower question — only
// `defaultValue` and `rules`, never a toggle, a holdout move, a prerequisite or an
// archive, and never the environments a global change newly REACHES. Every gap ran
// the same direction: the control offered a landing an env-limited user could not
// perform, which the server then refused.
//
// Deliberately synchronous. Resolving a holdout's environments needs a lookup the
// front end and the back end do differently, so that one input is injected and
// everything downstream of it is shared.

/**
 * A holdout's environments could not be resolved. The footprint then widens to
 * every environment, which is the only safe answer: a holdout may be enabled
 * where the flag itself is not, so no narrower set is guaranteed to contain what
 * the server will compute.
 */
export const HOLDOUT_ENVS_UNRESOLVED = "unresolved" as const;

export type HoldoutFootprint = string[] | typeof HOLDOUT_ENVS_UNRESOLVED;

/** The environments a flag currently serves, out of those allowed. */
export function servingEnvironments(
  feature: { environmentSettings?: Record<string, { enabled?: boolean }> },
  environmentIds: string[],
): string[] {
  const settings = feature.environmentSettings ?? {};
  return environmentIds.filter((env) => !!settings[env]?.enabled);
}

/**
 * The environments a holdout move reaches: those active in the holdout being left
 * and in the one being joined. A holdout may be enabled where the flag is not, so
 * this can widen the footprint beyond the flag's own environments.
 *
 * Ids that don't resolve come back separately rather than being dropped — the two
 * callers mean different things by it. The server resolves from the database, so an
 * unresolvable id is a holdout that no longer exists and contributes nothing; the
 * front end resolves from a loaded map, so an unresolvable id means "not loaded",
 * which has to widen the footprint instead of narrowing it.
 */
export function holdoutEnvsForChange({
  currentHoldoutId,
  newHoldout,
  environmentIds,
  resolve,
}: {
  currentHoldoutId: string | undefined;
  /** `undefined` = the change doesn't touch holdout at all; `null` = cleared. */
  newHoldout: { id: string } | null | undefined;
  environmentIds: string[];
  resolve: (
    id: string,
  ) =>
    | { environmentSettings?: Record<string, { enabled?: boolean }> }
    | null
    | undefined;
}): { envs: string[]; unresolved: string[] } {
  if (newHoldout === undefined) return { envs: [], unresolved: [] };

  const ids: string[] = [];
  // The one being left counts only when it is actually being left.
  if (currentHoldoutId && currentHoldoutId !== newHoldout?.id) {
    ids.push(currentHoldoutId);
  }
  if (newHoldout?.id) ids.push(newHoldout.id);

  const envs = new Set<string>();
  const unresolved: string[] = [];
  for (const id of ids) {
    const holdout = resolve(id);
    if (!holdout) {
      unresolved.push(id);
      continue;
    }
    servingEnvironments(holdout, environmentIds).forEach((e) => envs.add(e));
  }
  return { envs: [...envs], unresolved };
}

export function featurePublishFootprint({
  feature,
  liveRules,
  changes,
  environmentIds,
  holdoutEnvs,
}: {
  feature: { environmentSettings?: Record<string, { enabled?: boolean }> };
  /** Live rules, already filled/upgraded, to compare the draft's against. */
  liveRules: FeatureRule[];
  changes: MergeResultChanges;
  environmentIds: string[];
  /**
   * The environments affected by a holdout move — `[]` when the change doesn't
   * touch holdout, or `HOLDOUT_ENVS_UNRESOLVED` when the caller can't say.
   */
  holdoutEnvs: HoldoutFootprint;
}): string[] {
  const serving = servingEnvironments(feature, environmentIds);

  if (holdoutEnvs === HOLDOUT_ENVS_UNRESOLVED) return [...environmentIds];

  const changedRuleEnvs =
    changes.rules === undefined
      ? []
      : environmentIds.filter(
          (env) =>
            !isEqual(
              getRulesForEnvironment(liveRules, env),
              getRulesForEnvironment(changes.rules ?? [], env),
            ),
        );

  const envScoped = new Set([
    ...changedRuleEnvs,
    ...Object.keys(changes.environmentsEnabled ?? {}),
    ...holdoutEnvs,
  ]);

  // A global field serves every environment, so the footprint is everything the
  // change reaches — including an environment this same draft ENABLES, which is
  // not yet in `serving`. `revertFootprint` applies the same rule.
  const touchesGlobalField =
    changes.defaultValue !== undefined ||
    !!changes.prerequisites ||
    changes.archived !== undefined ||
    !!changes.metadata;
  if (touchesGlobalField) {
    return Array.from(new Set([...serving, ...envScoped]));
  }

  return envScoped.size > 0 ? Array.from(envScoped) : serving;
}

/**
 * The environments a REVERT answers for: those the flag serves now, plus any the
 * restored revision would switch back ON, plus any whose rules it would change.
 *
 * Currently-serving alone under-counts — restoring a revision that re-enables
 * production is a production change, and pairing that with a project move let one
 * land without production authority in the destination. An environment re-enabled
 * with identical rules shows up in the enable half and not the rule half, which is
 * how each half came to be missed on its own.
 */
export function revertFootprint({
  feature,
  targetRevision,
  environmentIds,
  changedEnvs = [],
}: {
  feature: { environmentSettings?: Record<string, { enabled?: boolean }> };
  targetRevision: { environmentsEnabled?: Record<string, boolean> };
  environmentIds: string[];
  /** Environments whose rule lists the revert would change. */
  changedEnvs?: string[];
}): string[] {
  const envs = new Set(servingEnvironments(feature, environmentIds));
  for (const [env, enabled] of Object.entries(
    targetRevision.environmentsEnabled ?? {},
  )) {
    if (enabled && environmentIds.includes(env)) envs.add(env);
  }
  for (const env of changedEnvs) {
    if (environmentIds.includes(env)) envs.add(env);
  }
  return Array.from(envs);
}
