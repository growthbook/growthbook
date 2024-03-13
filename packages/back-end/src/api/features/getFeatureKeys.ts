import { getFeatureKeysValidator } from "@/src/validators/openapi";
import { GetFeatureKeysResponse } from "@/types/openapi";
import { getAllFeatures } from "@/src/models/FeatureModel";
import { createApiRequestHandler } from "@/src/util/handler";

export const getFeatureKeys = createApiRequestHandler(getFeatureKeysValidator)(
  async (req): Promise<GetFeatureKeysResponse> => {
    const features = await getAllFeatures(req.context, req.query.projectId);

    return features.map((f) => f.id);
  }
);
