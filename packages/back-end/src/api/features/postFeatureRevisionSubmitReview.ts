import omit from "lodash/omit";
import { z } from "zod";
import { getReviewSetting } from "shared/util";
import { isNamedUser } from "shared/types/events/event-types";
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

export const postFeatureRevisionSubmitReview = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    comment: z.string().optional().default(""),
    action: z
      .enum(["approve", "request-changes", "comment"])
      .default("comment"),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new Error("Could not find feature");

  if (!req.context.permissions.canReviewFeatureDrafts(feature)) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new Error("Could not find feature revision");

  const { action, comment } = req.body;
  const review = actionToReviewType[action];

  // Block self-approval for named users (dashboard or PAC); anonymous API keys are service accounts
  if (action === "approve") {
    const requireReviews = req.context.org.settings?.requireReviews;
    const reviewSetting = Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, feature)
      : undefined;
    if (reviewSetting?.blockSelfApproval) {
      const isSelfApproval = (revision.contributors ?? []).some(
        (c) => isNamedUser(c) && c.id === req.context.userId,
      );
      if (isSelfApproval) {
        throw new Error("You cannot approve a draft you contributed to.");
      }
    }
  }

  if (
    action !== "comment" &&
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new Error(
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

  return { revision: omit(updated ?? revision, "organization") };
});
