import { listDataSourcesValidator } from "@back-end/src/validators/openapi";
import { ListDataSourcesResponse } from "@back-end/types/openapi";
import {
  getDataSourcesByOrganization,
  toDataSourceApiInterface,
} from "@back-end/src/models/DataSourceModel";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "@back-end/src/util/handler";

export const listDataSources = createApiRequestHandler(
  listDataSourcesValidator
)(
  async (req): Promise<ListDataSourcesResponse> => {
    const dataSources = await getDataSourcesByOrganization(req.context);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      dataSources
        .filter((datasource) =>
          applyFilter(req.query.projectId, datasource.projects, true)
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      dataSources: filtered.map((dataSource) =>
        toDataSourceApiInterface(dataSource)
      ),
      ...returnFields,
    };
  }
);
