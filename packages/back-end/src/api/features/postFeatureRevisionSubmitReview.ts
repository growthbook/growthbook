import { postFeatureRevisionSubmitReviewValidator } from "shared/validators";
import { getReviewSetting } from "shared/util";
import { canCommentOnRevisionEntity } from "shared/permissions";
import type { ApiRequestLocals } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { dispatchRevisionReviewEvent } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { mayBeRevisionAuthor } from "back-end/src/revisions/revisionAuthority";
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

  const { action = "comment", comment } = req.body;
  const review = actionToReviewType[action];

  // A VERDICT is the review atom; a plain comment is participation and takes the
  // shared comment predicate instead — the same split the internal controller and
  // the other three entities make. Demanding review for both meant this endpoint
  // refused the very role an org grants to let people comment, while its dashboard
  // twin allowed it.
  if (
    action === "comment"
      ? !canCommentOnRevisionEntity(req.context.permissions, "feature", null, {
          project: feature.project,
        })
      : !req.context.permissions.canReviewFeatureDrafts(feature)
  ) {
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

  // Block the creator from any non-comment review action.
  //
  // An org-scoped API key carries no `id` on either side — `eventUserApiKey.id` is
  // optional and a key context has userId "" — so an identity comparison here was
  // structurally skipped, not merely tied, and such a key could create a draft,
  // request review and approve it. `mayBeRevisionAuthor` asks the question this gate
  // actually needs: not "is this provably the creator" but "could it be". Same rule
  // the generic revision paths apply.
  const creatorId =
    revision.createdBy != null && "id" in revision.createdBy
      ? revision.createdBy.id
      : "";
  if (
    action !== "comment" &&
    mayBeRevisionAuthor(creatorId, req.context.userId)
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
        (id) => id === req.context.userId,
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
