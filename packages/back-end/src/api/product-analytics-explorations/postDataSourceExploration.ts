import { PostDataSourceExplorationResponse } from "shared/types/openapi";
import { dataSourceExplorationConfigValidator } from "shared/validators";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { toDataSourceExplorationApiInterface } from "back-end/src/models/AnalyticsExplorationModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postDataSourceExploration = createApiRequestHandler({
  bodySchema: dataSourceExplorationConfigValidator,
})(async (req): Promise<PostDataSourceExplorationResponse> => {
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
    exploration: toDataSourceExplorationApiInterface(exploration),
    query: query ? toQueryApiInterface(query) : null,
  };
});
