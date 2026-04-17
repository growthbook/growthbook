import { putFeatureRevisionArchiveValidator } from "shared/validators";
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

export const putFeatureRevisionArchive = createApiRequestHandler(
  putFeatureRevisionArchiveValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
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

    const currentArchived = revision.archived ?? feature.archived ?? false;
    if (currentArchived === req.body.archived) {
      await discardIfJustCreated(req.context, revision, created);
      return { revision: revisionToApiInterface(revision) };
    }

    await updateRevision(
      req.context,
      feature,
      revision,
      { archived: req.body.archived },
      {
        user: req.context.auditUser,
        action: req.body.archived ? "archive feature" : "unarchive feature",
        subject: "",
        value: JSON.stringify({ archived: req.body.archived }),
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

    await recordRevisionUpdate(req.context, feature, finalRevision, "archive", {
      auditDetails: { archived: req.body.archived },
    });

    return { revision: revisionToApiInterface(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
