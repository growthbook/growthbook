import { z } from "zod";
import { ApiDimensionInterface, ApiPaginationFields } from "../../../types/api";
import {
  findDimensionsByOrganization,
  toDimensionApiInterface,
} from "../../models/DimensionModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listDimensions = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (
    req
  ): Promise<ApiPaginationFields & { dimensions: ApiDimensionInterface[] }> => {
    const dimensions = await findDimensionsByOrganization(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      dimensions.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      dimensions: filtered.map((dimension) =>
        toDimensionApiInterface(dimension)
      ),
      ...returnFields,
    };
  }
);
