import {
  PermissionError,
  MergeResultChanges,
  isArchiveTransition,
  isPureFeatureArchive,
  isPureFeatureRevert,
} from "shared/util";
import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

/**
 * Who may move a feature draft along, and who may land it.
 *
 * Draft authority covers every draft. Beyond that, revert authority reaches a
 * draft that only restores a published revision, delete authority one that only
 * archives the flag, and either reaches a draft the caller authored whatever it
 * contains — so a single-purpose role can finish what it may start.
 *
 * Purity checks read a second revision, so they run only after the cheap atom
 * check fails.
 */

/**
 * These gate DRAFT-advance paths only — request review, recall, discard — which
 * publish nothing, so they ask for the atom in the feature's project and not over
 * any environment. Same footprint the revert-draft endpoint uses to create the
 * draft in the first place; landing it is checked separately against the merge
 * footprint. An env list here would let an env-limited reverter create a draft it
 * could then neither advance nor discard.
 */
function hasRevertAuthority(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): boolean {
  return context.permissions.canRevertFeature(feature, NO_ENVIRONMENT_BINDING);
}

function hasDeleteAuthority(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): boolean {
  return context.permissions.canDeleteFeature(feature, NO_ENVIRONMENT_BINDING);
}

/** The caller opened this draft, or has contributed changes to it. */
export function authoredFeatureDraft(
  context: ReqContext | ApiReqContext,
  draft: Pick<FeatureRevisionInterface, "createdBy" | "contributors">,
): boolean {
  const userId = context.userId;
  if (!userId) return false;
  if (draft.createdBy && "id" in draft.createdBy) {
    if (draft.createdBy.id === userId) return true;
  }
  return (draft.contributors ?? []).includes(userId);
}

/** Whether the draft restores a state that was actually live. */
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
  if (!target || target.status !== "published") return false;

  return isPureFeatureRevert({ feature, draft, target });
}

/** Whether the draft is one this caller's narrow atom would let them land. */
async function matchesNarrowAtom({
  context,
  feature,
  draft,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): Promise<boolean> {
  if (
    hasDeleteAuthority(context, feature) &&
    isPureFeatureArchive({ feature, draft })
  ) {
    return true;
  }

  if (!hasRevertAuthority(context, feature)) return false;
  return draftIsPureRevert({ context, feature, draft });
}

/**
 * Request review, or recall a review request. Recall additionally requires the
 * caller to have skin in the draft — retracting someone else's review request
 * isn't something a narrow atom should confer.
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
    authoredFeatureDraft(context, draft) &&
    (hasRevertAuthority(context, feature) ||
      hasDeleteAuthority(context, feature))
  ) {
    return true;
  }
  return matchesNarrowAtom({ context, feature, draft });
}

/**
 * Discarding. A caller may always discard a draft they authored, whatever it
 * contains — and revert/delete authority additionally covers a pure revert or
 * pure archive opened by someone else, matching what they could land.
 */
export async function canDiscardFeatureDraft({
  context,
  feature,
  draft,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): Promise<boolean> {
  return canAdvanceFeatureDraft({ context, feature, draft });
}

/**
 * Recalling a review request the caller made. Draft authority keeps its
 * existing reach; the narrow atoms only reach their own drafts.
 */
export async function canRecallFeatureReview({
  context,
  feature,
  draft,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): Promise<boolean> {
  if (context.permissions.canEditFeatureDrafts(feature)) return true;
  return (
    authoredFeatureDraft(context, draft) &&
    (hasRevertAuthority(context, feature) ||
      hasDeleteAuthority(context, feature))
  );
}

/**
 * Draft authority covers any rebase. The narrow atoms cover one that pulls in
 * nothing, so a single-purpose role can satisfy "require drafts to be rebased
 * before publishing" without gaining a way to sweep someone else's changes in.
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
 * Landing authority: publish authority over the environments the merge touches,
 * or a narrow atom over a draft that only does what that atom covers. Approval
 * is a separate gate, enforced by the caller.
 */
/**
 * Boolean form of `assertCanPublishFeatureRevision`, for callers that must decide
 * feasibility rather than refuse outright — bulk publish collects gates instead
 * of throwing. Delegates rather than reimplements so a bulk publish and a single
 * publish can never disagree about what is allowed.
 */
export async function canPublishFeatureRevisionChange(
  args: Parameters<typeof assertCanPublishFeatureRevision>[0],
): Promise<boolean> {
  try {
    await assertCanPublishFeatureRevision(args);
    return true;
  } catch (e) {
    if (e instanceof PermissionError) return false;
    throw e;
  }
}

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
  // Archiving takes the flag out of service wherever it lands, not just via the
  // archive endpoint. Unarchiving returns it to service and is an ordinary
  // publish.
  if (
    isArchiveTransition({
      proposed: mergeChanges?.archived,
      current: feature.archived,
    }) &&
    !context.permissions.canDeleteFeature(feature, environments)
  ) {
    context.permissions.throwPermissionError();
  }

  // A move has to land where the publisher has authority, not just leave where
  // they do — whoever stages it needn't be whoever publishes it.
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

  // Staging an archive as a draft must not require an atom that landing it in
  // one step doesn't.
  if (
    context.permissions.canDeleteFeature(feature, environments) &&
    isPureFeatureArchive({ feature, draft: revision })
  ) {
    return;
  }

  context.permissions.throwPermissionError();
}
