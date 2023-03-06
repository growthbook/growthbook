import { ListFeaturesResponse } from "../../../types/openapi";
import { getAllFeatures } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "../../util/handler";
import { listFeaturesValidator } from "../../validators/openapi";

export const listFeatures = createApiRequestHandler(listFeaturesValidator)(
  async (req): Promise<ListFeaturesResponse> => {
    const features = await getAllFeatures(req.organization.id);
    const groupMap = await getSavedGroupMap(req.organization);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      features
        .filter((feature) => applyFilter(req.query.projectId, feature.project))
        .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()),
      req.query
    );

    return {
      features: filtered.map((feature) =>
        getApiFeatureObj(feature, req.organization, groupMap)
      ),
      ...returnFields,
    };
  }
);
