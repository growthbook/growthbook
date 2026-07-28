import { isEqual } from "lodash";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import { MergeResultChanges } from "./features";

/**
 * "Is this draft purely an X?" — the questions a narrow atom asks before acting
 * on a draft it didn't author. Revert authority may move a draft that only
 * restores a published revision; delete authority may move one that only
 * archives the flag.
 *
 * These live in shared because the answer must be identical on both surfaces:
 * the client decides what to offer, the server decides what to allow, and a
 * disagreement shows up as a button that fails.
 *
 * Rules arrive already normalized — both `FeatureModel.migrateRawFeatureToV2`
 * and `FeatureRevisionModel.buildFeatureRevisionInterface` run
 * `upgradeFeatureRule` on read — so nothing here re-migrates. Were an
 * un-normalized rule ever passed in, the comparison would read as impure and
 * the caller would deny, which is the safe direction.
 */

// Plain content: restoring these puts back a value that was already live.
// `rules` and `environmentsEnabled` are handled separately.
const CONTENT_FIELDS = [
  "defaultValue",
  "prerequisites",
  "archived",
  "metadata",
] as const;

// Effects reaching beyond this feature: never restorable, only left untouched.
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
 * Whether an `archived` value flips the flag out of service. Only this
 * direction is delete-class; unarchiving returns a flag to service and is
 * publish-class.
 */
export function isArchiveTransition({
  proposed,
  current,
}: {
  proposed: boolean | undefined;
  current: boolean | undefined;
}): boolean {
  return proposed === true && !current;
}

function plausibleRules(rules: unknown): FeatureRule[] {
  return ((rules ?? []) as FeatureRule[]).filter(
    (r) => r != null && typeof r === "object" && !Array.isArray(r),
  );
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

// `createRevision` writes an entry for every environment it was handed,
// defaulting absent ones to false — and the env list differs per caller.
// Compare per environment instead of whole-object, so those filled-in keys
// don't read as edits.
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
 * Whether a feature draft restores `target`'s content and changes nothing else.
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

  const proposedRules = plausibleRules(draft.rules);
  const rulesRestore =
    isEqual(proposedRules, plausibleRules(target.rules)) ||
    isEqual(proposedRules, plausibleRules(feature.rules));
  if (!rulesRestore) return false;

  if (!environmentsEnabledOnlyRestore({ feature, draft, target })) return false;

  return CONTENT_FIELDS.every((field) => {
    const proposed = draft[field];
    if (isEqual(proposed, target[field])) return true;
    return isEqual(proposed, liveValueFor(field, feature));
  });
}

/**
 * Whether a feature draft only archives the flag and changes nothing else.
 * The delete-authority counterpart to `isPureFeatureRevert`.
 */
export function isPureFeatureArchive({
  feature,
  draft,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): boolean {
  if (
    !isArchiveTransition({
      proposed: draft.archived,
      current: feature.archived,
    })
  ) {
    return false;
  }

  if (draft.rampActions?.length) return false;
  if (!isEqual(draft.holdout ?? null, feature.holdout ?? null)) return false;

  if (!isEqual(plausibleRules(draft.rules), plausibleRules(feature.rules))) {
    return false;
  }

  const proposedEnvs = draft.environmentsEnabled ?? {};
  const envsUnchanged = Object.entries(proposedEnvs).every(
    ([env, enabled]) =>
      enabled === (feature.environmentSettings?.[env]?.enabled ?? false),
  );
  if (!envsUnchanged) return false;

  return CONTENT_FIELDS.filter((field) => field !== "archived").every((field) =>
    isEqual(draft[field], liveValueFor(field, feature)),
  );
}
