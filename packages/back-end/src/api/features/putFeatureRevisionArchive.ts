import omit from "lodash/omit";
import { z } from "zod";
import { resetReviewOnChange } from "shared/util";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  isDraftStatus,
  resolveOrCreateRevision,
  versionOrNew,
} from "./validations";

export const putFeatureRevisionArchive = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: versionOrNew }),
  bodySchema: z.object({
    archived: z.boolean(),
  }),
})(async (req) => {
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

  return { revision: omit(updated ?? revision, "organization") };
});
