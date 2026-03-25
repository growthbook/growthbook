import {
  PostDataSourceExplorationResponse,
  ApiQuery,
} from "shared/types/openapi";
import { dataSourceExplorationConfigValidator } from "shared/validators";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { createApiRequestHandler } from "back-end/src/util/handler";

type Response = PostDataSourceExplorationResponse & {
  query: ApiQuery | null;
};

export const postDataSourceExploration = createApiRequestHandler({
  bodySchema: dataSourceExplorationConfigValidator,
})(async (req): Promise<Response> => {
  const exploration = await runProductAnalyticsExploration(
    req.context,
    req.body,
    {},
  );

  if (!exploration) {
    throw new Error("Failed to run data source exploration");
  }

  const queryId = exploration.queries?.[0]?.query;
  const query = queryId ? await getQueryById(req.context, queryId) : null;

  return {
    productAnalyticsExploration: {
      id: exploration.id,
      dateCreated: exploration.dateCreated.toISOString(),
      dateUpdated: exploration.dateUpdated.toISOString(),
      datasource: exploration.datasource,
      status: exploration.status,
      dateStart: exploration.dateStart,
      dateEnd: exploration.dateEnd,
      error: exploration.error ?? null,
      result: exploration.result,
    },
    query: query ? toQueryApiInterface(query) : null,
  };
});
