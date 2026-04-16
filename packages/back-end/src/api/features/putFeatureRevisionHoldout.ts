import { putFeatureRevisionHoldoutValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { revisionToApiInterface } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { isDraftStatus, resolveOrCreateRevision } from "./validations";

export const putFeatureRevisionHoldout = createApiRequestHandler(
  putFeatureRevisionHoldoutValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
  );

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Cannot edit a revision with status "${revision.status}"`,
    );
  }

  // Validate the holdout exists. Side effects (linking features / experiments
  // to the holdout, moving linkage off the old holdout) are applied at publish
  // time via applyHoldoutSideEffects — they are NOT skipped here.
  if (req.body.holdout) {
    const holdout = await req.context.models.holdout.getById(
      req.body.holdout.id,
    );
    if (!holdout) {
      throw new NotFoundError(
        `Could not find holdout "${req.body.holdout.id}"`,
      );
    }
  }

  await updateRevision(
    req.context,
    feature,
    revision,
    { holdout: req.body.holdout },
    {
      user: req.context.auditUser,
      action: req.body.holdout ? "set holdout" : "clear holdout",
      subject: req.body.holdout?.id ?? "",
      value: JSON.stringify(req.body.holdout),
    },
    resetReviewOnChange({
      feature,
      changedEnvironments: [],
      defaultValueChanged: false,
      settings: req.organization.settings,
    }),
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: revision.version,
  });

  return { revision: revisionToApiInterface(updated ?? revision) };
});
