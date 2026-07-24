import { postFeatureRevisionRecallReviewV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  recallReview,
} from "back-end/src/models/FeatureRevisionModel";

export const postFeatureRevisionRecallReviewV2 = createApiRequestHandler(
  postFeatureRevisionRecallReviewV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canManageFeatureDrafts(feature)) {
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

  const allowed = ["pending-review", "changes-requested", "approved"];
  if (!allowed.includes(revision.status)) {
    throw new BadRequestError(
      `Can only recall a review on a pending-review, changes-requested, or approved draft (status is "${revision.status}")`,
    );
  }

  await recallReview(req.context, revision, req.context.auditUser);

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  return { revision: toApiRevisionV2(updated ?? revision) };
});
