import { isEqual } from "lodash";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { MergeResultChanges } from "shared/util";
import { FeatureRevisionInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { isPlausibleFeatureRule } from "back-end/src/util/flattenRules";
import { upgradeFeatureRule } from "back-end/src/util/migrations";
import { isArchiveTransition } from "back-end/src/revisions/archiveTransition";

// Plain content: restoring these puts back a value that was already live.
// `rules` and `environmentsEnabled` are handled separately — createRevision
// rewrites both when storing a draft, so they need normalizing first.
const CONTENT_FIELDS = [
  "defaultValue",
  "prerequisites",
  "archived",
  "metadata",
] as const;

// Effects reaching beyond this feature: never restorable, only left untouched.
// Enforced in isPureFeatureRevert; named here for the exhaustiveness check.
type SideEffectField = "holdout";

// Every publishable field must be classified as content or side effect: adding
// one to MergeResultChanges without deciding which fails the build.
type UnclassifiedMergeField = Exclude<
  keyof MergeResultChanges,
  | (typeof CONTENT_FIELDS)[number]
  | SideEffectField
  | "rules"
  | "environmentsEnabled"
>;
const _allMergeFieldsClassified: UnclassifiedMergeField extends never
  ? true
  : never = true;
void _allMergeFieldsClassified;

/**
 * Whether a feature draft restores `target`'s content and changes nothing else.
 * Only consulted on the revert fallback, never for callers who can publish.
 *
 * Each content field must equal the target's value (a restoration) or live's (a
 * no-op). The no-op branch covers sparse legacy targets, whose unrecorded
 * envelopes `createRevision` fills from the live feature.
 *
 * `rampActions` and `holdout` must be no-ops even when the target recorded
 * something different — "restoring" them still fires a side effect beyond this
 * feature (ramp-schedule create/detach, holdout membership).
 */
export function isPureFeatureRevert({
  feature,
  draft,
  target,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
  target: FeatureRevisionInterface;
}): boolean {
  if (draft.revertedFromVersion === undefined) return false;
  if (draft.revertedFromVersion !== target.version) return false;

  // Side effects must be no-ops — see the note above.
  if (draft.rampActions?.length) return false;
  if (!isEqual(draft.holdout ?? null, feature.holdout ?? null)) return false;

  if (!rulesOnlyRestore({ feature, draft, target })) return false;
  if (!environmentsEnabledOnlyRestore({ feature, draft, target })) return false;

  return CONTENT_FIELDS.every((field) => {
    const proposed = draft[field];
    if (isEqual(proposed, target[field])) return true;
    return isEqual(proposed, liveValueFor(field, feature));
  });
}

// `createRevision` stores rules through normalizeRulesInputToV2 (and upgrades
// live rules when filling), so compare normalized shapes — otherwise a faithful
// revert reads as impure purely because of a v1/v2 or pre-coverage difference.
function rulesOnlyRestore({
  feature,
  draft,
  target,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
  target: FeatureRevisionInterface;
}): boolean {
  const normalize = (rules: unknown) =>
    ((rules ?? []) as FeatureRule[])
      .filter(isPlausibleFeatureRule)
      .map((r) => upgradeFeatureRule(r));

  const proposed = normalize(draft.rules);
  return (
    isEqual(proposed, normalize(target.rules)) ||
    isEqual(proposed, normalize(feature.rules))
  );
}

// `createRevision` writes an entry for every environment it was handed,
// defaulting absent ones to false — and the env list differs per caller. Compare
// per environment instead of whole-object, so those filled-in keys don't read as
// edits.
function environmentsEnabledOnlyRestore({
  feature,
  draft,
  target,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
  target: FeatureRevisionInterface;
}): boolean {
  const proposed = draft.environmentsEnabled ?? {};
  const restored = target.environmentsEnabled ?? {};

  return Object.entries(proposed).every(([env, enabled]) => {
    if (env in restored) return enabled === restored[env];
    return enabled === (feature.environmentSettings?.[env]?.enabled ?? false);
  });
}

/**
 * Whether the caller may move this draft through the review workflow. Draft
 * authority covers any draft; revert authority covers one that only restores a
 * previously-published revision, so a revert-only role can shepherd its own
 * rollback instead of stranding it. The purity check runs only on the fallback.
 */
export async function canAdvanceFeatureDraft({
  context,
  feature,
  draft,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): Promise<boolean> {
  if (context.permissions.canEditFeatureDrafts(feature)) return true;
  if (
    !context.permissions.canRevertFeature(
      feature,
      Array.from(
        getEnabledEnvironments(feature, getEnvironmentIdsFromOrg(context.org)),
      ),
    )
  ) {
    return false;
  }
  return draftIsPureRevert({ context, feature, draft });
}

/**
 * A rebase that pulls in nothing: every merge field undefined, bar an empty
 * environment map. Defined once so the internal and REST rebase paths can't
 * drift on what "no-op" means.
 */
export function rebasePullsInNothing(
  mergeChanges: MergeResultChanges,
): boolean {
  return Object.entries(mergeChanges).every(([field, value]) => {
    if (value === undefined) return true;
    if (field === "environmentsEnabled") {
      return Object.keys(value ?? {}).length === 0;
    }
    return false;
  });
}

/**
 * Draft authority covers any rebase. Revert authority covers one that pulls in
 * nothing, so a revert-only role can satisfy "require drafts to be rebased
 * before publishing" without gaining a way to sweep someone else's changes into
 * its rollback.
 */
export async function canRebaseFeatureDraft({
  context,
  feature,
  draft,
  mergeChanges,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
  // Absent when the merge failed: unresolved conflicts need resolutions, which
  // is never a no-op, so those always take draft authority.
  mergeChanges?: MergeResultChanges;
}): Promise<boolean> {
  if (context.permissions.canEditFeatureDrafts(feature)) return true;
  if (!mergeChanges || !rebasePullsInNothing(mergeChanges)) return false;
  return canAdvanceFeatureDraft({ context, feature, draft });
}

/**
 * Publish authority for the environments the merge touches, or revert authority
 * for a draft that only restores a previously-published revision. The purity
 * check runs only on the fallback, so publishers pay no extra load.
 */
export async function assertCanPublishFeatureRevision({
  context,
  feature,
  revision,
  environments,
  mergeChanges,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  environments: string[];
  mergeChanges?: MergeResultChanges;
}): Promise<void> {
  // A merge that archives the feature is delete-class wherever it lands, not
  // just via the archive endpoint — archiving takes the flag out of service and
  // is what lets it then be deleted freely. Unarchiving is an ordinary payload
  // change, covered by the publish check below.
  if (
    isArchiveTransition({
      proposed: mergeChanges?.archived,
      current: feature.archived,
    }) &&
    !context.permissions.canDeleteFeature(feature, environments)
  ) {
    context.permissions.throwPermissionError();
  }

  // A merge that moves the flag to another project has to land where the
  // publisher has authority, not just leave where they do. Staging the move
  // already checks the destination, but the person who stages it and the person
  // who publishes it needn't be the same. Mirrors `ownershipChanged` on the
  // engine's publish path.
  const destination = mergeChanges?.metadata?.project;
  if (
    destination !== undefined &&
    (destination || "") !== (feature.project || "") &&
    !context.permissions.canPublishFeature(
      { project: destination },
      environments,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  if (context.permissions.canPublishFeature(feature, environments)) return;

  if (
    context.permissions.canRevertFeature(feature, environments) &&
    (await draftIsPureRevert({ context, feature, draft: revision }))
  ) {
    return;
  }

  context.permissions.throwPermissionError();
}

export async function draftIsPureRevert({
  context,
  feature,
  draft,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): Promise<boolean> {
  if (draft.revertedFromVersion === undefined) return false;

  const target = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: draft.revertedFromVersion,
  });
  // Only a state that was actually live can be restored under revert authority.
  if (!target || target.status !== "published") return false;

  return isPureFeatureRevert({ feature, draft, target });
}

function liveValueFor(
  field: (typeof CONTENT_FIELDS)[number],
  feature: FeatureInterface,
): unknown {
  switch (field) {
    case "defaultValue":
      return feature.defaultValue;
    case "prerequisites":
      return feature.prerequisites ?? [];
    case "archived":
      return feature.archived ?? false;
    case "metadata":
      // The metadata envelope mirrors the live feature's own fields.
      return {
        description: feature.description,
        owner: feature.owner,
        project: feature.project,
        tags: feature.tags,
        neverStale: feature.neverStale,
        customFields: feature.customFields,
        jsonSchema: feature.jsonSchema,
        valueType: feature.valueType,
        baseConfig: feature.baseConfig ?? null,
      };
  }
}
