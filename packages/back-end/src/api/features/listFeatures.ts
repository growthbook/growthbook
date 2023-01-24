import { z } from "zod";
import { ApiFeatureInterface, ApiPaginationFields } from "../../../types/api";
import { getAllFeatures } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listFeatures = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (
    req
  ): Promise<ApiPaginationFields & { features: ApiFeatureInterface[] }> => {
    const features = await getAllFeatures(req.organization.id);
    const groupMap = await getSavedGroupMap(req.organization);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      features.sort(
        (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
      ),
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
