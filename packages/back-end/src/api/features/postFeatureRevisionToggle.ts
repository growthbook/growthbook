import omit from "lodash/omit";
import { z } from "zod";
import { resetReviewOnChange } from "shared/util";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { isDraftStatus } from "./validations";

export const postFeatureRevisionToggle = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    environment: z.string(),
    enabled: z.boolean(),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const { environment, enabled } = req.body;

  const allEnvironments = getEnvironments(req.context.org);
  if (!allEnvironments.some((e) => e.id === environment)) {
    throw new Error(`Invalid environment: "${environment}"`);
  }

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  if (!req.context.permissions.canPublishFeature(feature, [environment])) {
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
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
