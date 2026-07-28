import { FeatureInterface } from "shared/types/feature";
import {
  MergeResultChanges,
  isArchiveTransition,
  isPureFeatureArchive,
  isPureFeatureRevert,
} from "shared/util";
import { FeatureRevisionInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

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

  // Delete authority lands a draft that only archives the flag, the same change
  // the archive endpoint would let it land directly. Staging it as a draft first
  // must not require an atom that landing it in one step doesn't. Approval is
  // enforced separately by the caller — this decides authority only.
  if (
    context.permissions.canDeleteFeature(feature, environments) &&
    isPureFeatureArchive({ feature, draft: revision })
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
