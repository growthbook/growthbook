import { PostFactTableExplorationResponse } from "shared/types/openapi";
import { factTableExplorationConfigValidator } from "shared/validators";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { toFactTableExplorationApiInterface } from "back-end/src/models/AnalyticsExplorationModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postFactTableExploration = createApiRequestHandler({
  bodySchema: factTableExplorationConfigValidator,
})(async (req): Promise<PostFactTableExplorationResponse> => {
  const exploration = await runProductAnalyticsExploration(
    req.context,
    req.body,
    {},
  );

  if (!exploration) {
    throw new Error("Failed to run fact table exploration");
  }

  const queryId = exploration.queries?.[0]?.query;
  const query = queryId ? await getQueryById(req.context, queryId) : null;

  return {
    exploration: toFactTableExplorationApiInterface(exploration),
    query: query ? toQueryApiInterface(query) : null,
  };
});
