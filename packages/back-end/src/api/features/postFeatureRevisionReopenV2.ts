import { postFeatureRevisionReopenV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  reopenRevision,
} from "back-end/src/models/FeatureRevisionModel";

export const postFeatureRevisionReopenV2 = createApiRequestHandler(
  postFeatureRevisionReopenV2Validator,
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

  if (revision.status !== "discarded") {
    throw new BadRequestError(
      `Can only reopen discarded revisions (status is "${revision.status}")`,
    );
  }

  await reopenRevision(req.context, revision, req.context.auditUser);

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  const finalRevision = updated ?? revision;

  await req.audit({
    event: "feature.revision.reopen",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { status: revision.status },
      { status: finalRevision.status },
      { version: revision.version },
    ),
  });

  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    finalRevision,
    "revision.reopened",
    {},
  );

  return { revision: toApiRevisionV2(finalRevision) };
});
