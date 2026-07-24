import { isEqual } from "lodash";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { MergeResultChanges } from "shared/util";
import { FeatureRevisionInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { isPlausibleFeatureRule } from "back-end/src/util/flattenRules";
import { upgradeFeatureRule } from "back-end/src/util/migrations";

// Fields a feature publish writes that are plain content: restoring them puts
// back a value that was already live, so revert authority covers them.
// (Together with the side-effect fields below this must account for every field
// in MergeResultChanges, or the omitted one becomes a way to smuggle a change
// through revert authority.)
// Compared field-by-field below. `rules` and `environmentsEnabled` need shape
// normalization first (createRevision rewrites both when storing a draft), so
// they're handled separately rather than by the generic comparison.
const CONTENT_FIELDS = [
  "defaultValue",
  "prerequisites",
  "archived",
  "metadata",
] as const;

// Fields a publish writes whose effect reaches beyond this feature, so they can
// never be "restored" under revert authority — only left untouched. Enforced
// explicitly in isPureFeatureRevert; named here for the exhaustiveness check.
type SideEffectField = "holdout";

// Compile-time exhaustiveness: every field a publish can write must be
// classified as content or side effect. Adding one to MergeResultChanges without
// classifying it here fails the build rather than silently becoming a way to
// smuggle a change through revert authority.
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
 *
 * Only consulted when the caller is relying on revert authority rather than
 * publish authority. Each content field must either
 *   - equal the target revision's value (a restoration), or
 *   - equal the live feature's current value (a no-op for that field).
 *
 * The no-op branch is what makes sparse legacy targets work: `createRevision`
 * fills unset envelopes (prerequisites, environmentsEnabled, archived, metadata)
 * from the live feature, so a revert to a sparse revision legitimately carries
 * live values for the fields that revision never recorded. Anything else
 * — an edited value, or live drifting after the draft was created — reads as
 * impure and falls back to needing publish authority.
 *
 * Actions and side effects reaching beyond the feature document are held to a
 * stricter rule — they must be a no-op, even when the target revision recorded a
 * different value, because "restoring" them still fires the side effect:
 *   - `rampActions` executes ramp-schedule create/detach at publish time.
 *   - `holdout` changes holdout membership, not just a field on this feature.
 * A revert that would move either one needs full publish authority.
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
 * Gate a feature publish: normal publish authority for the environments the
 * merge touches, or revert authority for a draft that only restores a
 * previously-published revision.
 *
 * Purity is checked ONLY on the revert fallback, so callers who can already
 * publish are unaffected and pay no extra revision load.
 */
export async function assertCanPublishFeatureRevision({
  context,
  feature,
  revision,
  environments,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  environments: string[];
}): Promise<void> {
  if (context.permissions.canPublishFeature(feature, environments)) return;

  if (
    context.permissions.canRevertFeature(feature, environments) &&
    (await draftIsPureRevert({ context, feature, draft: revision }))
  ) {
    return;
  }

  context.permissions.throwPermissionError();
}

async function draftIsPureRevert({
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
