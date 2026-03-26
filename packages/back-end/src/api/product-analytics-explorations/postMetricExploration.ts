import { PostMetricExplorationResponse } from "shared/types/openapi";
import {
  metricExplorationConfigValidator,
  explorationCacheQuerySchema,
} from "shared/validators";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { toMetricExplorationApiInterface } from "back-end/src/models/AnalyticsExplorationModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const postMetricExploration = createApiRequestHandler({
  bodySchema: metricExplorationConfigValidator,
  querySchema: explorationCacheQuerySchema,
})(async (req): Promise<PostMetricExplorationResponse> => {
  const exploration = await runProductAnalyticsExploration(
    req.context,
    req.body,
    { cache: req.query.cache },
  );

  if (!exploration) {
    throw new NotFoundError(
      'No cached result found for this config. Try again shortly or use cache: "preferred".',
    );
  }

  const queryId = exploration.queries?.[0]?.query;
  const query = queryId ? await getQueryById(req.context, queryId) : null;

  return {
    exploration: toMetricExplorationApiInterface(exploration),
    query: query ? toQueryApiInterface(query) : null,
  };
});
