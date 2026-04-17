import { putFeatureRevisionHoldoutValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { revisionToApiInterface } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

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

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: req.body.revisionTitle, comment: req.body.revisionComment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    // Side effects (linking the feature/experiments to the holdout) run at
    // publish time via applyHoldoutSideEffects, not here.
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
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(req.context, feature, finalRevision, "holdout", {
      auditDetails: { holdoutId: req.body.holdout?.id ?? null },
    });

    return { revision: revisionToApiInterface(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
