import { z } from "zod";
import { ListDataSourcesResponse } from "../../../types/openapi";
import {
  getDataSourcesByOrganization,
  toDataSourceApiInterface,
} from "../../models/DataSourceModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listDataSources = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (req): Promise<ListDataSourcesResponse> => {
    const dataSources = await getDataSourcesByOrganization(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      dataSources.sort((a, b) => a.id.localeCompare(b.id)),
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
