import omit from "lodash/omit";
import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  discardRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";

const revisionParamsSchema = z.object({
  id: z.string(),
  version: z.coerce.number().int(),
});

export const postFeatureRevisionDiscard = createApiRequestHandler({
  paramsSchema: revisionParamsSchema,
  bodySchema: z.object({}),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new Error("Could not find feature");

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
  if (!revision) throw new Error("Could not find feature revision");

  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error(`Cannot discard a ${revision.status} revision`);
  }

  await discardRevision(req.context, revision, req.context.auditUser);

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
