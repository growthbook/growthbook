import { GetFeatureKeysResponse } from "../../../types/openapi";
import { getAllFeatures } from "../../models/FeatureModel";
import { createApiRequestHandler } from "../../util/handler";
import { getFeatureKeysValidator } from "../../validators/openapi";

export const getFeatureKeys = createApiRequestHandler(getFeatureKeysValidator)(
  async (req): Promise<GetFeatureKeysResponse> => {
    const features = await getAllFeatures(req.context, req.query.projectId);

    return features.map((f) => f.id);
  },
);
