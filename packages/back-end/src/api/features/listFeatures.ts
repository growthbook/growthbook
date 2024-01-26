import { ListFeaturesResponse } from "../../../types/openapi";
import { getAllPayloadExperiments } from "../../models/ExperimentModel";
import { getAllFeatures } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listFeaturesValidator } from "../../validators/openapi";

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
