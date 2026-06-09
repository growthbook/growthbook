import { postFeatureRevisionUndoReviewV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  undoReview,
} from "back-end/src/models/FeatureRevisionModel";

export const postFeatureRevisionUndoReviewV2 = createApiRequestHandler(
  postFeatureRevisionUndoReviewV2Validator,
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
    feature,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  const allowed = ["approved", "changes-requested"];
  if (!allowed.includes(revision.status)) {
    throw new BadRequestError(
      `Can only undo a review on an approved or changes-requested draft (status is "${revision.status}")`,
    );
  }

  await undoReview(req.context, revision, req.context.auditUser);

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  return { revision: toApiRevisionV2(updated ?? revision) };
});
