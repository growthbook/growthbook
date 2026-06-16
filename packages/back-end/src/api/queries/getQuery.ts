import { getQueryValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

export const getQuery = createApiRequestHandler(getQueryValidator)(async (
  req,
) => {
  const { id } = req.params;
  const query = await getQueryById(req.context, id);
  if (!query) {
    throw new Error(`A query with id ${id} does not exist`);
  }

  const datasource = await getDataSourceById(req.context, query.datasource);
  if (
    !datasource ||
    !req.context.permissions.canReadMultiProjectResource(datasource.projects)
  ) {
    req.context.permissions.throwPermissionError();
  }

  return {
    query: toQueryApiInterface(query),
  };
});
