import { postFeatureRevisionRequestReviewValidator } from "shared/validators";
import { revisionToApiInterface } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  markRevisionAsReviewRequested,
} from "back-end/src/models/FeatureRevisionModel";

export const postFeatureRevisionRequestReview = createApiRequestHandler(
  postFeatureRevisionRequestReviewValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  // Gated on canManageFeatureDrafts only so contributors can request approval
  // on drafts they can't publish themselves.
  if (!req.context.permissions.canManageFeatureDrafts(feature)) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (revision.status !== "draft") {
    throw new BadRequestError(
      `Can only request review on a draft (status is "${revision.status}")`,
    );
  }

  await markRevisionAsReviewRequested(
    req.context,
    revision,
    req.context.auditUser,
    req.body.comment ?? "",
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: revisionToApiInterface(updated ?? revision) };
});
