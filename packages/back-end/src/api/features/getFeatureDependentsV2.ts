import { getFeatureDependentsValidator } from "shared/validators";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getFeatureDependents } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getFeatureDependentsV2 = createApiRequestHandler(
  getFeatureDependentsValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature)
    throw new NotFoundError("Could not find a feature with that key");
  const dependents = await getFeatureDependents(req.context, [feature.id]);
  return dependents[feature.id];
});
