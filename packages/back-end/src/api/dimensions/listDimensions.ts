import { ListDimensionsResponse } from "back-end/types/openapi";
import {
  findDimensionsByOrganization,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { listDimensionsValidator } from "back-end/src/validators/openapi";

export const listDimensions = createApiRequestHandler(listDimensionsValidator)(
  async (req): Promise<ListDimensionsResponse> => {
    const dimensions = await findDimensionsByOrganization(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      dimensions
        .filter((dimension) =>
          applyFilter(req.query.datasourceId, dimension.datasource)
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
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
