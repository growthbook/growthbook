import { getFeatureRevisionLatestValidator } from "shared/validators";
import { revisionToApiInterface } from "back-end/src/services/features";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getLatestActiveDraftForFeature } from "back-end/src/models/FeatureRevisionModel";

export const getFeatureRevisionLatest = createApiRequestHandler(
  getFeatureRevisionLatestValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getLatestActiveDraftForFeature(
    req.context,
    req.organization.id,
    feature.id,
  );
  if (!revision) {
    throw new NotFoundError("No active draft revision found for this feature");
  }

  return { revision: revisionToApiInterface(revision) };
});
