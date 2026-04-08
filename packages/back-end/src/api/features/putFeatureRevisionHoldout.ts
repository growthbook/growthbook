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
import { isDraftStatus } from "./validations";

export const putFeatureRevisionHoldout = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    holdout: z.object({ id: z.string(), value: z.string() }).nullable(),
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
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
