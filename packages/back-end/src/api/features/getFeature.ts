import { getRevision } from "../../models/FeatureRevisionModel";
import { GetFeatureResponse } from "../../../types/openapi";
import { getExperimentMapForFeature } from "../../models/ExperimentModel";
import { getFeature as getFeatureDB } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { createApiRequestHandler } from "../../util/handler";
import { getFeatureValidator } from "../../validators/openapi";

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
