import { z } from "zod";
import { ApiFeatureInterface, ApiPaginationFields } from "../../../types/api";
import { getAllFeatures } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { createApiRequestHandler } from "../../util/handler";

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
    const limit = parseInt(req.query.limit || "10");
    const offset = parseInt(req.query.offset || "0");
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new Error("Pagination limit must be between 1 and 100");
    }
    if (isNaN(offset) || offset < 0 || offset >= features.length) {
      throw new Error("Invalid pagination offset");
    }

    const filtered = features
      .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime())
      .slice(offset, limit + offset);

    const nextOffset = offset + limit;
    const hasMore = nextOffset < features.length;

    return {
      features: filtered.map((feature) =>
        getApiFeatureObj(feature, req.organization, groupMap)
      ),
      limit,
      offset,
      count: filtered.length,
      total: features.length,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
    };
  }
);
