import { canCommentOnRevisionEntity } from "shared/permissions";
import { ANY_REVIEW_FOOTPRINT, getReviewSetting } from "shared/util";
import { FeatureInterface } from "shared/validators";
import { EventUser } from "shared/types/events/event-types";
import { ReqContext } from "back-end/types/request";
import { BadRequestError } from "back-end/src/util/errors";
import { mayBeRevisionAuthor } from "back-end/src/revisions/revisionAuthority";
import { ApiReqContext } from "back-end/types/api";
import {
  getRevision,
  ReviewSubmittedType,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";
import { getFeatureReviewFootprint } from "back-end/src/services/features";
import { dispatchRevisionReviewEvent } from "back-end/src/services/featureRevisionEvents";
import { maybeAutoPublishFeatureRevision } from "back-end/src/api/features/autoPublishOnApproval";

// Shared by the internal and managed-flag routes.
export async function submitFeatureRevisionReview({
  context,
  feature,
  version,
  review = "Comment",
  comment,
  eventAudit,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  version: number;
  review?: ReviewSubmittedType;
  comment: string;
  eventAudit: EventUser;
}): Promise<void> {
  // A verdict is the review atom; a comment is participation.
  const canCommentHere = canCommentOnRevisionEntity(
    context.permissions,
    "feature",
    null,
    { project: feature.project },
  );
  if (review === "Comment" && !canCommentHere) {
    context.permissions.throwPermissionError();
  }
  // Pre-fetch gate so callers can't probe revision versions.
  if (
    review !== "Comment" &&
    !context.permissions.canReviewFeatureDrafts(feature, ANY_REVIEW_FOOTPRINT)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version,
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (review !== "Comment") {
    const footprint = await getFeatureReviewFootprint({
      context,
      feature,
      revision,
    });
    if (!context.permissions.canReviewFeatureDrafts(feature, footprint)) {
      context.permissions.throwPermissionError();
    }
  }
  // Verdicts may stand alone, but a plain comment must have a body.
  if (review === "Comment" && !comment?.trim()) {
    throw new Error("Comment cannot be empty");
  }

  // `mayBeRevisionAuthor`: an identityless principal must not approve its own authorless draft.
  const creatorId =
    revision.createdBy != null && "id" in revision.createdBy
      ? revision.createdBy.id
      : "";
  if (review !== "Comment" && mayBeRevisionAuthor(creatorId, context.userId)) {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // contributors[] is empty on legacy drafts, which therefore bypass this.
  const requireReviews = context.org.settings?.requireReviews;
  const blockSelfApproval = Array.isArray(requireReviews)
    ? !!getReviewSetting(requireReviews, feature)?.blockSelfApproval
    : false;
  // Re-applied inside the CAS.
  if (review === "Approved" && blockSelfApproval) {
    const isSelfApproval = (revision.contributors ?? []).some(
      (id) => id === context.userId,
    );
    if (isSelfApproval) {
      throw new Error("You cannot approve a draft you contributed to.");
    }
  }
  // dont allow review unless you are adding a comment
  if (
    !(
      revision.status === "changes-requested" ||
      revision.status === "pending-review" ||
      revision.status === "approved"
    ) &&
    review !== "Comment"
  ) {
    throw new Error("Can only review if review is requested");
  }
  const { applied } = await submitReviewAndComments(
    context,
    revision,
    eventAudit,
    review,
    comment,
    // Capture the live version the approval is made against so a later publish
    // can detect when the approval has gone stale.
    feature.version,
    blockSelfApproval,
  );
  if (!applied) {
    // Not persisted: a concurrent recall, discard or publish moved the revision on.
    throw new Error(
      "This revision is no longer in review — it was recalled, published or discarded while the request was in flight.",
    );
  }

  const updatedRevision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version,
  });
  const finalRevision = updatedRevision ?? revision;

  const auditUser = context.auditUser;
  const reviewer =
    auditUser && auditUser.type !== "system"
      ? { id: auditUser.id, name: auditUser.name, email: auditUser.email }
      : {};

  await dispatchRevisionReviewEvent(
    context,
    feature,
    revision,
    finalRevision,
    review,
    comment,
    reviewer,
  );

  if (review === "Approved") {
    await maybeAutoPublishFeatureRevision(context, feature, finalRevision);
  }
}
