import { postFeatureRevisionRequestReviewValidator } from "shared/validators";
import { revisionToApiInterface } from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { auditDetailsUpdate } from "back-end/src/services/audit";
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
  const finalRevision = updated ?? revision;

  await req.audit({
    event: "feature.revision.requestReview",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { status: revision.status },
      { status: finalRevision.status },
      { version: revision.version, comment: req.body.comment ?? "" },
    ),
  });

  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    finalRevision,
    "revision.reviewRequested",
    { reviewComment: req.body.comment ?? null },
  );

  return { revision: revisionToApiInterface(finalRevision) };
});
