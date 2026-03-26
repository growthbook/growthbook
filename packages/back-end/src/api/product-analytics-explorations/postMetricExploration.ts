import { PostMetricExplorationResponse } from "shared/types/openapi";
import { metricExplorationConfigValidator } from "shared/validators";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { toMetricExplorationApiInterface } from "back-end/src/models/AnalyticsExplorationModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postMetricExploration = createApiRequestHandler({
  bodySchema: metricExplorationConfigValidator,
})(async (req): Promise<PostMetricExplorationResponse> => {
  const exploration = await runProductAnalyticsExploration(
    req.context,
    req.body,
    {},
  );

  if (!exploration) {
    throw new Error("Failed to run metric exploration");
  }

  const queryId = exploration.queries?.[0]?.query;
  const query = queryId ? await getQueryById(req.context, queryId) : null;

  return {
    exploration: toMetricExplorationApiInterface(exploration),
    query: query ? toQueryApiInterface(query) : null,
  };
});
