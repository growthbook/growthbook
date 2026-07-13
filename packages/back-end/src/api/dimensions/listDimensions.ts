import { listDimensionsValidator } from "shared/validators";
import {
  findDimensionsByOrganization,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listDimensions = createApiRequestHandler(listDimensionsValidator)(
  async (req) => {
    const dimensions = await findDimensionsByOrganization(req.organization.id);

    // A dimension's project access is inherited from its datasource, so restrict
    // to datasources the caller can read (already filtered by project access).
    const readableDatasourceIds = new Set(
      (await getDataSourcesByOrganization(req.context)).map((ds) => ds.id),
    );

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      dimensions
        .filter((dimension) => readableDatasourceIds.has(dimension.datasource))
        .filter((dimension) =>
          applyFilter(req.query.datasourceId, dimension.datasource),
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
      req.query,
    );

    return {
      dimensions: await resolveOwnerEmails(
        filtered.map((dimension) => toDimensionApiInterface(dimension)),
        req.context,
      ),
      ...returnFields,
    };
  },
);
