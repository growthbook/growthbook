import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "@back-end/src/services/features";
import { listFeaturesValidator } from "@back-end/src/validators/openapi";
import { ListFeaturesResponse } from "@back-end/types/openapi";
import { getAllPayloadExperiments } from "@back-end/src/models/ExperimentModel";
import { getAllFeatures } from "@back-end/src/models/FeatureModel";
import {
  applyPagination,
  createApiRequestHandler,
} from "@back-end/src/util/handler";

export const listFeatures = createApiRequestHandler(listFeaturesValidator)(
  async (req): Promise<ListFeaturesResponse> => {
    const features = await getAllFeatures(req.context, req.query.projectId);
    const groupMap = await getSavedGroupMap(req.organization);
    const experimentMap = await getAllPayloadExperiments(
      req.context,
      req.query.projectId
    );

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      features.sort(
        (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
      ),
      req.query
    );

    return {
      features: filtered.map((feature) =>
        getApiFeatureObj({
          feature,
          organization: req.organization,
          groupMap,
          experimentMap,
        })
      ),
      ...returnFields,
    };
  }
);
