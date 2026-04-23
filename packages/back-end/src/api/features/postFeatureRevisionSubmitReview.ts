import { postFeatureRevisionSubmitReviewValidator } from "shared/validators";
import { getReviewSetting } from "shared/util";
import { revisionToApiInterface } from "back-end/src/services/features";
import { dispatchRevisionReviewEvent } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  ReviewSubmittedType,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";

const actionToReviewType: Record<string, ReviewSubmittedType> = {
  approve: "Approved",
  "request-changes": "Requested Changes",
  comment: "Comment",
};

export const postFeatureRevisionSubmitReview = createApiRequestHandler(
  postFeatureRevisionSubmitReviewValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canReviewFeatureDrafts(feature)) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  const { action = "comment", comment } = req.body;
  const review = actionToReviewType[action];

  // Block the creator from any non-comment review action.
  if (
    revision.createdBy != null &&
    "id" in revision.createdBy &&
    revision.createdBy.id === req.context.userId &&
    action !== "comment"
  ) {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block contributors from self-approving when `blockSelfApproval` is set.
  // request-changes / comment are intentionally allowed.
  if (action === "approve") {
    const requireReviews = req.context.org.settings?.requireReviews;
    const reviewSetting = Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, feature)
      : undefined;
    if (reviewSetting?.blockSelfApproval) {
      const isSelfApproval = (revision.contributors ?? []).some(
        (c) => c != null && "id" in c && c.id === req.context.userId,
      );
      if (isSelfApproval) {
        throw new BadRequestError(
          "You cannot approve a draft you contributed to.",
        );
      }
    }
  }

  if (
    action !== "comment" &&
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      `Can only submit a review when review has been requested (status is "${revision.status}")`,
    );
  }

  await submitReviewAndComments(
    req.context,
    revision,
    req.context.auditUser,
    review,
    comment,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  const finalRevision = updated ?? revision;

  const auditUser = req.context.auditUser;
  const reviewer =
    auditUser && auditUser.type !== "system"
      ? { id: auditUser.id, name: auditUser.name, email: auditUser.email }
      : {};

  await dispatchRevisionReviewEvent(
    req.context,
    feature,
    revision,
    finalRevision,
    review,
    comment,
    reviewer,
  );

  return { revision: revisionToApiInterface(finalRevision) };
});
