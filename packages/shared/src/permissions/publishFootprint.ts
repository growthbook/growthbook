// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import { isEqual } from "lodash";
import type { RevisionRampAction } from "shared/validators";
import type { FeatureRule } from "shared/types/feature";
import { resolveRampTargets } from "../util/ruleId";
import { getRulesForEnvironment } from "../util/index";
import type { MergeResultChanges } from "../util/features";

// Which environments publishing a Feature Flag draft reaches, and so which ones
// authority is required in. ONE function for endpoint and control alike — they derived
// it separately and disagreed every time, always in the direction that offered a
// landing the server then refused.
//
// Synchronous on purpose: holdout resolution differs between the apps, so that one
// input is injected and everything downstream of it is shared.

// Unresolvable holdout → widen to every environment. A holdout may be enabled where the
// flag is not, so no narrower set is guaranteed to contain what the server computes.
export const HOLDOUT_ENVS_UNRESOLVED = "unresolved" as const;

export type HoldoutFootprint = string[] | typeof HOLDOUT_ENVS_UNRESOLVED;

// Every environment the entity is reachable in — the footprint for a change with no
// narrower binding, an archive above all. Narrowed to the entity's projects: an
// environment scoped away from them never serves it, so demanding authority there
// refuses archives that should be allowed.
//
// If this ever returns empty, callers must NOT pass it as a footprint — an empty
// footprint SKIPS the environment check instead of narrowing it.
export function serveFootprint(
  environments: { id: string; projects?: string[] }[],
  entity: {
    project?: string;
    targetingProjects?: string[];
    targetingAllProjects?: boolean;
  },
): string[] {
  if (entity.targetingAllProjects) return environments.map((e) => e.id);
  const projects = [entity.project, ...(entity.targetingProjects ?? [])].filter(
    (p): p is string => !!p,
  );
  if (!projects.length) return environments.map((e) => e.id);
  return environments
    .filter(
      (env) =>
        !env.projects?.length ||
        projects.some((p) => env.projects?.includes(p)),
    )
    .map((e) => e.id);
}

/** The environments a flag currently serves, out of those allowed. */
export function servingEnvironments(
  feature: { environmentSettings?: Record<string, { enabled?: boolean }> },
  environmentIds: string[],
): string[] {
  const settings = feature.environmentSettings ?? {};
  return environmentIds.filter((env) => !!settings[env]?.enabled);
}

// The environments a holdout move reaches: those active in the one being left and the
// one being joined. Unresolvable ids come back SEPARATELY rather than dropped, because
// the callers mean different things by it — for the server the holdout is gone and
// contributes nothing; for the client it is merely unloaded, which must widen.
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

  // A global field serves everywhere, so the footprint is everything the change
  // reaches — including an environment this same draft ENABLES, not yet in `serving`.
  const touchesGlobalField =
    changes.defaultValue !== undefined ||
    !!changes.prerequisites ||
    changes.archived !== undefined ||
    metadataTouchesPayload(changes.metadata);
  if (touchesGlobalField) {
    return Array.from(new Set([...serving, ...envScoped]));
  }

  return envScoped.size > 0 ? Array.from(envScoped) : serving;
}

// What a REVERT answers for: serving now, plus any the restored revision switches back
// ON, plus any whose rules it changes. Each of the three was missed on its own — an
// environment re-enabled with identical rules appears in the enable half and not the
// rule half, and vice versa.
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

/**
 * A revision's publish footprint, widened when it flips `archived` in EITHER
 * direction — taking an entity out of service and returning it both reach
 * everywhere it serves.
 *
 * The rule the adapters apply server-side, exposed so the controls apply the same
 * one. Without it, a page derived the footprint from the change's own environments,
 * which is empty for an archive-only revision and empty for a base entity — and an
 * empty footprint SKIPS the environment check rather than narrowing it.
 */
export function revisionPublishFootprint({
  proposedChanges,
  currentArchived,
  scoped,
  serving,
}: {
  /** `archived` the revision would land, or undefined when it doesn't touch it. */
  proposedChanges: { archived?: boolean };
  currentArchived: boolean | undefined;
  /** The change's own environment binding, when it has one. */
  scoped: string[];
  /** Everywhere the entity serves — the fallback for an unbound change. */
  serving: string[];
}): string[] {
  const flips =
    proposedChanges.archived !== undefined &&
    proposedChanges.archived !== !!currentArchived;
  if (flips) return scoped.length ? scoped : serving;
  return scoped;
}

/**
 * Metadata fields that never reach an SDK payload — the pre-split `manageFeatures`
 * semantic, and the same set the publish GATE uses to decide a change needs no
 * publish authority at all.
 *
 * Named keys rather than a complement, so a new payload-affecting field fails safe
 * into "touches payload".
 */
const PAYLOAD_INERT_METADATA = new Set([
  "description",
  "owner",
  "tags",
  "neverStale",
  "customFields",
]);

/**
 * Whether a metadata change reaches the SDK payload.
 *
 * Shared with the gate for one reason: treating ANY metadata as global widened the
 * footprint to every serving environment, so editing a dev rule AND the
 * description refused a dev-limited publisher — while dropping the description
 * from the same request succeeded. The gate meanwhile skipped the publish check
 * entirely for that field. The two answers have to come from one place.
 */
export function metadataTouchesPayload(
  metadata: Record<string, unknown> | undefined,
): boolean {
  if (!metadata) return false;
  return Object.keys(metadata).some((key) => !PAYLOAD_INERT_METADATA.has(key));
}

// What an archive/unarchive answers for. NAMED so call sites stop spelling it: the raw
// org-environment list reads correct and is wrong, and survived a sweep that fixed seven
// siblings precisely because it looked right. Twin of the server's
// `archiveServeFootprint`. `scoped` is the entity's own binding (a Config's overrides);
// empty means unbound, and unbound means everywhere it serves.
export function archiveFootprintForControl({
  environments,
  entity,
  scoped = [],
}: {
  environments: { id: string; projects?: string[] }[];
  entity: {
    project?: string;
    targetingProjects?: string[];
    targetingAllProjects?: boolean;
  };
  scoped?: string[];
}): string[] {
  return scoped.length ? scoped : serveFootprint(environments, entity);
}

/**
 * The environments a revision's ramp actions reach: each action's patch
 * environments UNIONED with what its target rule currently serves, since a patch
 * naming `environments` REPLACES that field. Same rule the REST/internal ramp gate
 * applies via `getEnvsForRampTarget`; this is the revision-path half that had none.
 */
export function rampActionFootprint({
  rampActions,
  liveRules,
  environmentIds,
}: {
  rampActions?: RevisionRampAction[];
  liveRules: FeatureRule[];
  environmentIds: string[];
}): string[] | "all" {
  if (!rampActions?.length) return [];
  const envs = new Set<string>();
  for (const action of rampActions) {
    if (action.mode === "detach") {
      // Detaching stops the schedule acting on the rule, which is felt wherever
      // that rule serves.
      const targets = resolveRampTargets({ ruleId: action.ruleId }, liveRules);
      if (!targets.length || targets.some((r) => r.allEnvironments))
        return "all";
      for (const r of targets)
        for (const e of r.environments ?? []) envs.add(e);
      continue;
    }
    const patches = [
      ...(action.startActions ?? []),
      ...(action.steps ?? []).flatMap((st) => st.actions ?? []),
      ...(action.endActions ?? []),
    ].map((a) => a.patch);
    for (const patch of patches) {
      if (patch?.allEnvironments) return "all";
      // A patch WITHOUT an `environments` key does not touch the field —
      // `applyPatchToRule` only writes it on `"environments" in patch` — so its
      // reach is simply wherever the rule already serves, which the union below
      // supplies. Widening to "all" here demanded publish in every org environment
      // for the ordinary coverage-only step the UI emits, while the control asked
      // for the rule's own environments. `environments: []` is the same answer: the
      // rule stops serving where it served, and nowhere new.
      for (const e of patch?.environments ?? []) envs.add(e);
    }
    // The rule the actions aim at: a patch REPLACES its environments, so what it
    // serves now is part of the reach.
    const targets = resolveRampTargets({ ruleId: action.ruleId }, liveRules);
    if (!targets.length || targets.some((r) => r.allEnvironments)) return "all";
    for (const r of targets) for (const e of r.environments ?? []) envs.add(e);
  }
  // Intersected with the feature's applicable set: an environment scoped away from
  // its projects never serves it, so demanding authority there refuses a change with
  // no effect. `environmentIds` was taken and discarded before.
  return [...envs].filter((e) => environmentIds.includes(e));
}
