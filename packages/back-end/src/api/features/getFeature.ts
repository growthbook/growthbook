import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { GetFeatureResponse } from "back-end/types/openapi";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getFeature as getFeatureDB } from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeatureValidator } from "back-end/src/validators/openapi";

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
    const revision = await getRevision(
      feature.organization,
      feature.id,
      feature.version
    );
    return {
      feature: getApiFeatureObj({
        feature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
      }),
    };
  }
);
