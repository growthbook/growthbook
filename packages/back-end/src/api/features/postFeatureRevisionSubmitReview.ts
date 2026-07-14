import { postFeatureRevisionSubmitReviewValidator } from "shared/validators";
import { getReviewSetting } from "shared/util";
import type { ApiRequestLocals } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { dispatchRevisionReviewEvent } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  ReviewSubmittedType,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";
import { maybeAutoPublishFeatureRevision } from "./autoPublishOnApproval";

export const actionToReviewType: Record<string, ReviewSubmittedType> = {
  approve: "Approved",
  "request-changes": "Requested Changes",
  comment: "Comment",
};

export async function submitRevisionReview(
  req: Pick<ApiRequestLocals, "context" | "organization"> & {
    params: { id: string; version: number };
    body: {
      action?: "approve" | "request-changes" | "comment";
      comment?: string;
      skipAutoPublish?: boolean;
    };
  },
) {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canReviewFeatureDrafts(feature)) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  const { action = "comment", comment } = req.body;
  const review = actionToReviewType[action];

  // `request-changes` by the author doesn't make sense. Author may approve
  // their own revision when blockSelfApproval is off, and may always comment.
  if (
    revision.createdBy != null &&
    "id" in revision.createdBy &&
    revision.createdBy.id === req.context.userId &&
    action === "request-changes"
  ) {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block self-approval when `blockSelfApproval` is set at the org level.
  // When the setting is off, authors may approve their own revisions.
  // request-changes / comment are intentionally allowed for authors.
  if (action === "approve") {
    const requireReviews = req.context.org.settings?.requireReviews;
    const reviewSetting = Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, feature)
      : undefined;
    if (reviewSetting?.blockSelfApproval) {
      const createdByUser = revision.createdBy as
        | { id: string }
        | null
        | undefined;
      const isSelfApproval =
        (revision.contributors ?? []).some((id) => id === req.context.userId) ||
        createdByUser?.id === req.context.userId;
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
    // Capture the live version the approval is made against so a later publish
    // can detect when the approval has gone stale (parity with the internal
    // app's review flow).
    feature.version,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
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

  if (action === "approve" && !req.body.skipAutoPublish) {
    const afterAutoPublish = await maybeAutoPublishFeatureRevision(
      req.context,
      feature,
      finalRevision,
    );
    const didAutoPublish = afterAutoPublish.status === "published";
    return {
      feature,
      revision: afterAutoPublish,
      autoPublished: didAutoPublish,
    };
  }

  return { feature, revision: finalRevision, autoPublished: false };
}

export const postFeatureRevisionSubmitReview = createApiRequestHandler(
  postFeatureRevisionSubmitReviewValidator,
)(async (req) => {
  const { feature, revision, autoPublished } = await submitRevisionReview(req);
  return {
    revision: toApiRevision(revision, req.context, feature),
    autoPublished,
  };
});
