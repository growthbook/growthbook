import omit from "lodash/omit";
import { z } from "zod";
import { featurePrerequisite } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  isDraftStatus,
  validatePrerequisiteConditions,
  validatePrerequisiteReferences,
} from "./validations";

export const putFeatureRevisionPrerequisites = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    prerequisites: z.array(featurePrerequisite),
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

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  validatePrerequisiteConditions(req.body.prerequisites);
  await validatePrerequisiteReferences(req.body.prerequisites, req.context);

  await updateRevision(
    req.context,
    feature,
    revision,
    { prerequisites: req.body.prerequisites },
    {
      user: req.context.auditUser,
      action: "edit prerequisites",
      subject: "",
      value: JSON.stringify(req.body.prerequisites),
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
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
