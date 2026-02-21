import { GetFeatureKeysResponse } from "shared/types/openapi";
import { getFeatureKeysValidator } from "shared/validators";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFeatureKeys = createApiRequestHandler(getFeatureKeysValidator)(
  async (req): Promise<GetFeatureKeysResponse> => {
    const features = await getAllFeatures(req.context, {
      projects: req.query.projectId ? [req.query.projectId] : undefined,
    });

    return features.map((f) => f.id);
  },
);
