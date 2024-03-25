import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "@back-end/src/services/features";
import { getFeatureValidator } from "@back-end/src/validators/openapi";
import { GetFeatureResponse } from "@back-end/types/openapi";
import { getExperimentMapForFeature } from "@back-end/src/models/ExperimentModel";
import { getFeature as getFeatureDB } from "@back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getFeature = createApiRequestHandler(getFeatureValidator)(
  async (req): Promise<GetFeatureResponse> => {
    const feature = await getFeatureDB(req.context, req.params.id);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const groupMap = await getSavedGroupMap(req.organization);
    const experimentMap = await getExperimentMapForFeature(
      req.context,
      feature.id
    );
    return {
      feature: getApiFeatureObj({
        feature,
        organization: req.organization,
        groupMap,
        experimentMap,
      }),
    };
  }
);
