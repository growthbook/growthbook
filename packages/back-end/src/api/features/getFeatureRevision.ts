import {
  getFeatureRevisionValidator,
  getFeatureRevisionV2Validator,
} from "shared/validators";
import { toApiRevision, toApiRevisionV2 } from "back-end/src/services/features";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

export const getFeatureRevision = createApiRequestHandler(
  getFeatureRevisionValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  return { revision: toApiRevision(revision, req.context, feature) };
});

export const getFeatureRevisionV2 = createApiRequestHandler(
  getFeatureRevisionV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  return { revision: toApiRevisionV2(revision, req.context, feature) };
});
