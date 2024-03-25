import { getFeatureKeysValidator } from "@back-end/src/validators/openapi";
import { GetFeatureKeysResponse } from "@back-end/types/openapi";
import { getAllFeatures } from "@back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getFeatureKeys = createApiRequestHandler(getFeatureKeysValidator)(
  async (req): Promise<GetFeatureKeysResponse> => {
    const features = await getAllFeatures(req.context, req.query.projectId);

    return features.map((f) => f.id);
  }
);
