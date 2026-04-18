import { postFeatureRevisionToggleValidator } from "shared/validators";
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
  assertValidEnvironment,
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export const postFeatureRevisionToggle = createApiRequestHandler(
  postFeatureRevisionToggleValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { environment, enabled } = req.body;
  assertValidEnvironment(req.context, environment);

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

    const currentEnabled =
      revision.environmentsEnabled?.[environment] ??
      feature.environmentSettings?.[environment]?.enabled ??
      false;
    if (currentEnabled === enabled) {
      await discardIfJustCreated(req.context, revision, created);
      return { revision: revisionToApiInterface(revision) };
    }

    const newEnabled = {
      ...(revision.environmentsEnabled ?? {}),
      [environment]: enabled,
    };

    await updateRevision(
      req.context,
      feature,
      revision,
      { environmentsEnabled: newEnabled },
      {
        user: req.context.auditUser,
        action: enabled ? "enable environment" : "disable environment",
        subject: environment,
        value: JSON.stringify({ enabled }),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments: [environment],
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

    await recordRevisionUpdate(req.context, feature, finalRevision, "toggle", {
      environments: [environment],
      auditDetails: { enabled },
    });

    return { revision: revisionToApiInterface(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
