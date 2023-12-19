import { GetFeatureResponse } from "../../../types/openapi";
import { getExperimentMapForFeature } from "../../models/ExperimentModel";
import { getFeature as getFeatureDB } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { createApiRequestHandler } from "../../util/handler";
import { getFeatureValidator } from "../../validators/openapi";

export const getFeature = createApiRequestHandler(getFeatureValidator)(
  async (req): Promise<GetFeatureResponse> => {
    const feature = await getFeatureDB(
      req.organization.id,
      req.params.id,
      req.readAccessFilter
    );
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const groupMap = await getSavedGroupMap(req.organization);
    const experimentMap = await getExperimentMapForFeature(
      req.organization.id,
      feature.id,
      req.readAccessFilter
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
