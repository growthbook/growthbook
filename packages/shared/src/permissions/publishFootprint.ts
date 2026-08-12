// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import { isEqual } from "lodash";
import type { RevisionRampAction } from "shared/validators";
import type { FeatureRule } from "shared/types/feature";
import { resolveRampTargets } from "../util/ruleId";
import { getRulesForEnvironment } from "../util/index";
import type { MergeResultChanges } from "../util/features";

// Shared feature-publish footprint; holdout resolution is injected per app.

// Unresolvable holdout → widen to every environment. A holdout may be enabled where the
// flag is not, so no narrower set is guaranteed to contain what the server computes.
export const HOLDOUT_ENVS_UNRESOLVED = "unresolved" as const;

export type HoldoutFootprint = string[] | typeof HOLDOUT_ENVS_UNRESOLVED;

// Unbound changes use every environment the entity can serve; empty skips authorization.
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

// Return unresolved holdouts separately so callers can apply their own fallback.
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

  const changedRules = changes.rules;
  const changedRuleEnvs =
    changedRules === undefined
      ? []
      : environmentIds.filter(
          (env) =>
            !isEqual(
              getRulesForEnvironment(liveRules, env),
              getRulesForEnvironment(changedRules, env),
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

// What a REVERT answers for: serving now, plus any the restored revision switches
// back ON, plus any whose rules it changes. All three are needed — an environment
// re-enabled with identical rules appears only in the enable half.
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

/** Archive and unarchive changes reach every served environment. */
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

// Named explicitly so unknown metadata fails safe as payload-affecting.
const PAYLOAD_INERT_METADATA = new Set([
  "description",
  "owner",
  "tags",
  "neverStale",
  "customFields",
]);

export function metadataTouchesPayload(metadata: object | undefined): boolean {
  if (!metadata) return false;
  return Object.keys(metadata).some((key) => !PAYLOAD_INERT_METADATA.has(key));
}

// Empty scope means unbound, so archive authority spans every serving environment.
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

/** Ramp actions reach patched environments and the target rule's current scope. */
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
      // A patch WITHOUT an `environments` key does not touch the field
      // (`applyPatchToRule` only writes it on `"environments" in patch`), so its
      // reach is wherever the rule already serves — the union below. Widening to
      // "all" here would demand publish everywhere for an ordinary coverage-only
      // step. `environments: []` is the same answer: the rule stops serving where
      // it served, and nowhere new.
      for (const e of patch?.environments ?? []) envs.add(e);
    }
    // The rule the actions aim at: a patch REPLACES its environments, so what it
    // serves now is part of the reach.
    const targets = resolveRampTargets({ ruleId: action.ruleId }, liveRules);
    if (!targets.length || targets.some((r) => r.allEnvironments)) return "all";
    for (const r of targets) for (const e of r.environments ?? []) envs.add(e);
  }
  // Intersected with the feature's applicable set: an environment scoped away from
  // its projects never serves it, so demanding authority there refuses a change
  // with no effect.
  return [...envs].filter((e) => environmentIds.includes(e));
}
