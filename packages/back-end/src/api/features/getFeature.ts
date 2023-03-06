import { GetFeatureResponse } from "../../../types/openapi";
import { getFeature as getFeatureDB } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { createApiRequestHandler } from "../../util/handler";
import { getFeatureValidator } from "../../validators/openapi";

export const getFeature = createApiRequestHandler(getFeatureValidator)(
  async (req): Promise<GetFeatureResponse> => {
    const feature = await getFeatureDB(req.organization.id, req.params.id);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const groupMap = await getSavedGroupMap(req.organization);
    return {
      feature: getApiFeatureObj(feature, req.organization, groupMap),
    };
  }
);
