import { deleteFeatureRevisionRolloutV2Validator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export const deleteFeatureRevisionRolloutV2 = createApiRequestHandler(
  deleteFeatureRevisionRolloutV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { revisionTitle, revisionComment } = req.body;

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: revisionTitle, comment: revisionComment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const newRampActions = (revision.rampActions ?? []).filter(
      (a) => a.mode !== "create-feature-rollout",
    );

    const orgEnvs = getEnvironments(req.organization);
    const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);

    await updateRevision(
      req.context,
      feature,
      revision,
      { rampActions: newRampActions },
      {
        user: req.context.auditUser,
        action: "remove feature rollout",
        subject: feature.id,
        value: "",
      },
      resetReviewOnChange({
        feature,
        changedEnvironments: applicableEnvs,
        defaultValueChanged: false,
        settings: req.organization.settings,
      }),
    );

    const updated = await getRevision({
      context: req.context,
      organization: req.organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    return { revision: toApiRevisionV2(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
