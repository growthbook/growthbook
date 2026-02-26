import { getFeatureStaleValidator } from "shared/validators";
import { GetFeatureStaleResponse } from "shared/types/openapi";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFeatureStale = createApiRequestHandler(
  getFeatureStaleValidator,
)(async (req): Promise<GetFeatureStaleResponse> => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const neverStale = feature.neverStale ?? false;
  return {
    featureId: feature.id,
    isStale: neverStale ? false : (feature.isStale ?? false),
    staleReason: neverStale
      ? "never-stale"
      : feature.staleReason === "error" || !feature.staleReason
        ? null
        : feature.staleReason,
    staleLastCalculated: feature.staleLastCalculated?.toISOString() ?? null,
    neverStale,
  };
});
