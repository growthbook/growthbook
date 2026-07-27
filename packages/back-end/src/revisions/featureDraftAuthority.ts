import { FeatureInterface } from "shared/types/feature";
import { MergeResultChanges } from "shared/util";
import { FeatureRevisionInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  isPureFeatureArchive,
  isPureFeatureRevert,
} from "back-end/src/revisions/featureRevertPurity";

/**
 * Who may move a feature draft along — request review on it, recall that
 * request, discard it, rebase it.
 *
 * Draft authority covers every draft. Beyond that, two narrower atoms get a say
 * so a single-purpose role can finish what it is allowed to start:
 *
 * - revert authority, over a draft that only restores a published revision
 * - delete authority, over a draft that only archives the flag
 *
 * and, regardless of what the draft contains, over a draft the caller authored
 * themselves: you can always clean up your own mess.
 *
 * The purity checks read a second revision, so they run only after the cheap
 * atom check fails.
 */

function allEnabledEnvs(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): string[] {
  return Array.from(
    getEnabledEnvironments(feature, getEnvironmentIdsFromOrg(context.org)),
  );
}

function hasRevertAuthority(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): boolean {
  return context.permissions.canRevertFeature(
    feature,
    allEnabledEnvs(context, feature),
  );
}

function hasDeleteAuthority(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): boolean {
  return context.permissions.canDeleteFeature(
    feature,
    allEnabledEnvs(context, feature),
  );
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
