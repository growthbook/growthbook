import {
  ContextualBanditQueryAttribute,
  ContextualBanditQueryInterface,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

const DEFAULT_QUANTILE_BUCKETS = 4;
const DEFAULT_CATEGORICAL_LEVELS = 50;

export function getQuantileBucketEdges(
  values: number[],
  buckets: number = DEFAULT_QUANTILE_BUCKETS,
): number[] {
  if (buckets < 1) {
    throw new Error("buckets must be positive");
  }

  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return [];
  if (sorted.length === 1) {
    return Array.from({ length: buckets + 1 }, () => sorted[0]);
  }

  return Array.from({ length: buckets + 1 }, (_, index) => {
    const position = (index / buckets) * (sorted.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sorted[lowerIndex];
    const upper = sorted[upperIndex];
    const ratio = position - lowerIndex;

    return lower + (upper - lower) * ratio;
  });
}

function maxLevels(attribute: ContextualBanditQueryAttribute): number {
  return attribute.maxLevels ?? DEFAULT_CATEGORICAL_LEVELS;
}

function maxBuckets(attribute: ContextualBanditQueryAttribute): number {
  return attribute.maxLevels ?? DEFAULT_QUANTILE_BUCKETS;
}

function assertContextualBanditRefreshSupport(
  integration: SourceIntegrationInterface,
): asserts integration is SourceIntegrationInterface &
  Required<
    Pick<
      SourceIntegrationInterface,
      | "getContextualBanditTopValuesQuery"
      | "runContextualBanditTopValuesQuery"
      | "getContextualBanditQuantileBucketEdgesQuery"
      | "runContextualBanditQuantileBucketEdgesQuery"
    >
  > {
  if (
    !integration.getContextualBanditTopValuesQuery ||
    !integration.runContextualBanditTopValuesQuery ||
    !integration.getContextualBanditQuantileBucketEdgesQuery ||
    !integration.runContextualBanditQuantileBucketEdgesQuery
  ) {
    throw new Error(
      "Datasource does not support contextual bandit top-values refresh",
    );
  }
}

export async function refreshTopValuesForCBAQ(
  context: ReqContext,
  cbaqId: string,
): Promise<ContextualBanditQueryInterface> {
  const cbaq =
    await context.models.contextualBanditQueries.getByIdInOrg(cbaqId);
  if (!cbaq) {
    throw new Error(`Contextual Bandit Query not found: ${cbaqId}`);
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    cbaq.datasource,
    true,
  );
  assertContextualBanditRefreshSupport(integration);

  const attributes = await Promise.all(
    cbaq.attributes.map(async (attribute) => {
      if (attribute.kind === "categorical") {
        const sql = integration.getContextualBanditTopValuesQuery({
          query: cbaq.query,
          attribute: attribute.attribute,
          limit: maxLevels(attribute),
        });
        const result = await integration.runContextualBanditTopValuesQuery(sql);

        return {
          ...attribute,
          topValues: result.rows.map((row) => row.value),
          bucketEdges: undefined,
        };
      }

      const sql = integration.getContextualBanditQuantileBucketEdgesQuery({
        query: cbaq.query,
        attribute: attribute.attribute,
        buckets: maxBuckets(attribute),
      });
      const result =
        await integration.runContextualBanditQuantileBucketEdgesQuery(sql);

      return {
        ...attribute,
        topValues: undefined,
        bucketEdges: result.rows[0] ?? [],
      };
    }),
  );

  return context.models.contextualBanditQueries.update(cbaq, {
    attributes,
    topValuesLastRefreshed: new Date(),
  });
}
