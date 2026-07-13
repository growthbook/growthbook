import { listDimensionsValidator } from "shared/validators";
import {
  findDimensionsByOrganization,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import {
  getAllDatasourceIdsByOrganization,
  getDataSourcesByOrganization,
} from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listDimensions = createApiRequestHandler(listDimensionsValidator)(
  async (req) => {
    const dimensions = await findDimensionsByOrganization(req.organization.id);

    // A dimension inherits project access from its datasource. Drop it only when
    // the datasource exists but is inaccessible; orphaned dimensions whose
    // datasource no longer exists stay in the list.
    const readableDatasourceIds = new Set(
      (await getDataSourcesByOrganization(req.context)).map((ds) => ds.id),
    );
    const allDatasourceIds = await getAllDatasourceIdsByOrganization(
      req.context,
    );

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      dimensions
        .filter(
          (dimension) =>
            readableDatasourceIds.has(dimension.datasource) ||
            !allDatasourceIds.has(dimension.datasource),
        )
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
