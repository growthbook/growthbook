import omit from "lodash/omit";
import { postFeatureRevisionDiscardValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  discardRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";

export const postFeatureRevisionDiscard = createApiRequestHandler(
  postFeatureRevisionDiscardValidator,
)(async (req) => {
  const { id, version } = req.params;
  const context = req.context;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error(`Feature id '${id}' not found.`);
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    version,
  });
  if (!revision) {
    throw new Error(`Revision ${version} not found for feature '${id}'.`);
  }

  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error(`Cannot discard a ${revision.status} revision.`);
  }

  await discardRevision(context, revision, req.eventAudit);

  const updated = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    version,
  });
  if (!updated) {
    throw new Error("Failed to load updated revision.");
  }

  return {
    revision: omit(updated, "organization"),
  };
});
