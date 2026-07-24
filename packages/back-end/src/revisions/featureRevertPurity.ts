import { isEqual } from "lodash";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

// Fields a feature publish writes that are plain content: restoring them puts
// back a value that was already live, so revert authority covers them.
// (Together with the side-effect fields below this must account for every field
// in MergeResultChanges, or the omitted one becomes a way to smuggle a change
// through revert authority.)
const CONTENT_FIELDS = [
  "defaultValue",
  "rules",
  "environmentsEnabled",
  "prerequisites",
  "archived",
  "metadata",
] as const;

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

  const liveEnvironmentsEnabled = Object.fromEntries(
    Object.entries(feature.environmentSettings ?? {}).map(([env, settings]) => [
      env,
      !!settings?.enabled,
    ]),
  );

  return CONTENT_FIELDS.every((field) => {
    const proposed = draft[field];
    if (isEqual(proposed, target[field])) return true;
    return isEqual(
      proposed,
      liveValueFor(field, feature, liveEnvironmentsEnabled),
    );
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
  liveEnvironmentsEnabled: Record<string, boolean>,
): unknown {
  switch (field) {
    case "defaultValue":
      return feature.defaultValue;
    case "rules":
      return feature.rules ?? [];
    case "environmentsEnabled":
      return liveEnvironmentsEnabled;
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
