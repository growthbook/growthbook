import {
  MergeResultChanges,
  PermissionError,
  draftRevertedFromVersion,
  isArchiveTransition,
  isPureFeatureArchive,
  isPureFeatureRevert,
} from "shared/util";
import {
  NO_ENVIRONMENT_BINDING,
  metadataTouchesPayload,
} from "shared/permissions";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/validators";
import {
  assertCanLandRevision,
  canAdvanceDraftWithNarrowAtom,
  canDiscardOrRecallDraft,
  canRebaseWithNarrowAtom,
} from "back-end/src/revisions/landAuthority";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

// Who may move a feature draft along, and who may land it.
//
// Draft authority covers every draft. Beyond that, revert authority reaches a
// draft that only restores a published revision, delete authority one that only
// archives the flag, and either reaches a draft the caller authored whatever it
// contains — so a single-purpose role can finish what it may start.
//
// Purity checks read a second revision, so they run only after the cheap atom
// check fails.

// These gate DRAFT-advance paths only — request review, recall, discard — which
// publish nothing, so they ask for the atom in the feature's project and not over
// any environment. Same footprint the revert-draft endpoint uses to create the
// draft in the first place; landing it is checked separately against the merge
// footprint. An env list here would let an env-limited reverter create a draft it
// could then neither advance nor discard.
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

/**
 * The caller opened this draft, or has contributed changes to it. Gates the
 * narrow atoms' reach — without it, revert or delete authority would advance
 * anyone's draft. Pinned by featureDraftAuthority.test.ts.
 */
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

// Authority to CREATE a flag in the state the body describes.
//
// A new flag's live footprint is exactly the environments it starts enabled in, so
// publish authority is required for those and nothing else: a flag that starts
// disabled everywhere reaches no SDK payload, and Create alone is enough. Approval
// doesn't apply either — there is no prior state to review it against.
export function assertCanCreateFeatureInState({
  context,
  feature,
  environmentIds,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  environmentIds: string[];
}): void {
  const enabledOnCreate = Array.from(
    getEnabledEnvironments(feature, environmentIds),
  );
  if (
    enabledOnCreate.length &&
    !context.permissions.canPublishFeature(feature, enabledOnCreate)
  ) {
    context.permissions.throwPermissionError();
  }
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
  const revertedFromVersion = draftRevertedFromVersion(draft);
  if (revertedFromVersion === undefined) return false;

  const target = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: revertedFromVersion,
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
  return canAdvanceDraftWithNarrowAtom({
    holdsDraftAuthority: context.permissions.canEditFeatureDrafts(feature),
    isAuthor: authoredFeatureDraft(context, draft),
    holdsAnyLandingAtom:
      hasRevertAuthority(context, feature) ||
      hasDeleteAuthority(context, feature),
    matchesNarrowAtom: () => matchesNarrowAtom({ context, feature, draft }),
  });
}

/**
 * Discarding. Narrower than advancing, deliberately — the feature twin of
 * `canDiscardRevision`.
 *
 * `canAdvanceFeatureDraft` lets a narrow atom act on a draft that only does what
 * that atom covers (a deleter over a pure archive), which is right for moving your
 * own work along and wrong for destroying someone else's: a qa-style delete-only
 * role could discard another author's archive draft, including one already in
 * review. So: draft authority, or authorship.
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
  return canDiscardOrRecallDraft({
    holdsDraftAuthority: context.permissions.canEditFeatureDrafts(feature),
    isAuthor: authoredFeatureDraft(context, draft),
  });
}

/** Reopen requires draft authority or authorship, matching generic revisions. */
export async function canReopenFeatureDraft({
  context,
  feature,
  draft,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): Promise<boolean> {
  return canDiscardOrRecallDraft({
    holdsDraftAuthority: context.permissions.canEditFeatureDrafts(feature),
    isAuthor: authoredFeatureDraft(context, draft),
  });
}

/** Recall requires draft authority or authorship, matching generic revisions. */
export async function canRecallFeatureReview({
  context,
  feature,
  draft,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): Promise<boolean> {
  return canDiscardOrRecallDraft({
    holdsDraftAuthority: context.permissions.canEditFeatureDrafts(feature),
    isAuthor: authoredFeatureDraft(context, draft),
  });
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
  return canRebaseWithNarrowAtom({
    holdsDraftAuthority: context.permissions.canEditFeatureDrafts(feature),
    // Merge-result proof, rather than the snapshot comparison the generic path
    // uses: every field the merge would write is empty, so nothing crosses over.
    pullsInNothing: !!mergeChanges && rebasePullsInNothing(mergeChanges),
    canAdvance: () => canAdvanceFeatureDraft({ context, feature, draft }),
  });
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

// Landing authority: publish over the environments the merge touches, or a narrow
// atom over a draft that only does what that atom covers. Approval is a separate
// gate, enforced by the caller.
//
// Boolean form of `assertCanPublishFeatureRevision`, for callers that must decide
// feasibility rather than refuse outright — bulk publish collects gates instead
// of throwing. Delegates rather than reimplements so a bulk publish and a single
// publish can never disagree about what is allowed.
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

// Whether a merge result reaches the SDK payload at all. Inert metadata —
// description, owner, tags, staleness, custom fields — lands without publish
// authority (the pre-split `manageFeatures` semantic, pinned by the features
// matrix); everything else is a live write. Named keys, not a complement, so a
// new payload-affecting field fails safe into "touches payload". Ramp actions
// ride the REVISION (not the merge result) and always accompany rule changes,
// which are classified above.
export function mergeResultTouchesPayload(result: MergeResultChanges): boolean {
  if (
    result.defaultValue !== undefined ||
    result.rules !== undefined ||
    result.environmentsEnabled !== undefined ||
    result.prerequisites !== undefined ||
    result.archived !== undefined ||
    result.holdout !== undefined
  ) {
    return true;
  }
  return metadataTouchesPayload(
    result.metadata as Record<string, unknown> | undefined,
  );
}

/**
 * Publish authority over a revision's FULL footprint, destination included.
 *
 * A move has to land where the publisher has authority, not just leave where they
 * do — whoever stages it needn't be whoever publishes it. Shared so a preflight
 * cannot ask a narrower question than the publish it is predicting: a source-only
 * check would clear an armed publisher who had lost the destination.
 */
export function holdsFeaturePublishAuthority({
  context,
  feature,
  environments,
  mergeChanges,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  environments: string[];
  mergeChanges?: MergeResultChanges;
}): boolean {
  if (!context.permissions.canPublishFeature(feature, environments)) {
    return false;
  }
  const destination = mergeChanges?.metadata?.project;
  if (
    destination !== undefined &&
    (destination || "") !== (feature.project || "")
  ) {
    return context.permissions.canPublishFeature(
      { project: destination },
      environments,
    );
  }
  return true;
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
  // The destination half of the footprint. `assertCanLandRevision` below covers
  // the source; this is the same predicate every preflight asks, so the two
  // cannot answer differently.
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

  await assertCanLandRevision({
    context,
    // The footprint is already folded in: these three delegate to
    // canRevisionAction("feature", …, environments).
    holds: (action) =>
      action === "publish"
        ? context.permissions.canPublishFeature(feature, environments)
        : action === "revert"
          ? context.permissions.canRevertFeature(feature, environments)
          : context.permissions.canDeleteFeature(feature, environments),
    archives: isArchiveTransition({
      proposed: mergeChanges?.archived,
      current: feature.archived,
    }),
    // Feature revisions carry typed fields rather than JSON patch ops, so purity
    // is proven against the merge result instead of the op list.
    isPureRevert: () =>
      draftIsPureRevert({ context, feature, draft: revision }),
    isPureArchive: () => isPureFeatureArchive({ feature, draft: revision }),
  });
}

// Lives in `shared` so the Revert control predicts the same footprint the revert
// endpoints demand; re-exported here because this is where callers look for it.
export { revertFootprint } from "shared/permissions";
