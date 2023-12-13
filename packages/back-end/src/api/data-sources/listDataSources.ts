import { ListDataSourcesResponse } from "../../../types/openapi";
import {
  getDataSourcesByOrganization,
  toDataSourceApiInterface,
} from "../../models/DataSourceModel";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "../../util/handler";
import { listDataSourcesValidator } from "../../validators/openapi";

export const listDataSources = createApiRequestHandler(
  listDataSourcesValidator
)(
  async (req): Promise<ListDataSourcesResponse> => {
    const dataSources = await getDataSourcesByOrganization(
      req.organization.id,
      req.readAccessFilter
    );

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
