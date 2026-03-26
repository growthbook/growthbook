import {
  ApiProductAnalyticsDataSourceExploration,
  PostDataSourceExplorationResponse,
} from "shared/types/openapi";
import {
  dataSourceExplorationConfigValidator,
  explorationCacheQuerySchema,
} from "shared/validators";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postDataSourceExploration = createApiRequestHandler({
  bodySchema: dataSourceExplorationConfigValidator,
  querySchema: explorationCacheQuerySchema,
})(async (req): Promise<PostDataSourceExplorationResponse> => {
  const exploration = await runProductAnalyticsExploration(
    req.context,
    req.body,
    { cache: req.query.cache },
  );

  if (!exploration) {
    return {
      exploration: null,
      query: null,
      message:
        'No cached result found for this config. Try again shortly or use cache: "preferred".',
    };
  }

  const queryId = exploration.queries?.[0]?.query;
  const query = queryId ? await getQueryById(req.context, queryId) : null;

  return {
    exploration:
      req.context.models.analyticsExplorations.toExplorationApiInterface(
        exploration,
      ) as ApiProductAnalyticsDataSourceExploration,
    query: query ? toQueryApiInterface(query) : null,
  };
});
