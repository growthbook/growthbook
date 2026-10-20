import {
  listDataSourceQueriesValidator,
  postQueryCancelValidator,
} from "shared/validators";
import {
  getQueriesByDatasource,
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { cancelRunningQuery } from "back-end/src/services/datasourceChanges";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listDataSourceQueries = createApiRequestHandler(
  listDataSourceQueriesValidator,
)(async (req) => {
  // getDataSourceById returns null unless the caller can read the data source
  const datasource = await getDataSourceById(req.context, req.params.id);
  if (!datasource) {
    throw new NotFoundError(`Data source not found: ${req.params.id}`);
  }
  const queries = await getQueriesByDatasource(
    req.context.org.id,
    datasource.id,
  );
  return { queries: queries.map(toQueryApiInterface) };
});

export const postQueryCancel = createApiRequestHandler(
  postQueryCancelValidator,
)(async (req) => {
  const { context } = req;
  const query = await getQueryById(context, req.params.id);
  const datasource =
    query && (await getDataSourceById(context, query.datasource));
  if (!query || !datasource) {
    throw new NotFoundError(`Query not found: ${req.params.id}`);
  }
  if (!context.permissions.canRunTestQueries(datasource)) {
    context.permissions.throwPermissionError();
  }
  await cancelRunningQuery(
    context,
    query,
    context.email || context.userId || `API key ${context.apiKey}`,
  );
  const cancelled = (await getQueryById(context, query.id)) ?? query;
  return { query: toQueryApiInterface(cancelled) };
});
