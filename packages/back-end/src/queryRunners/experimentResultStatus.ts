import type { QueryStatus, QueryType } from "shared/types/query";
import { filterParentQueryPointers } from "./unitDimensionQueryNaming";

const EXPERIMENT_METRIC_QUERY_TYPES: ReadonlySet<string> = new Set([
  "experimentMetric",
  "experimentMultiMetric",
  "experimentResults",
  "experimentIncrementalRefreshStatistics",
] satisfies QueryType[]);

export type ExperimentResultQuery = {
  status: QueryStatus;
  queryType?: string;
};

export function getExperimentResultStatus(
  queries: readonly ExperimentResultQuery[],
): QueryStatus {
  if (
    queries.some(({ status }) => status === "queued" || status === "running")
  ) {
    return "running";
  }

  const hasSucceededMetricQuery = queries.some(
    ({ status, queryType }) =>
      status === "succeeded" &&
      queryType !== undefined &&
      EXPERIMENT_METRIC_QUERY_TYPES.has(queryType),
  );
  if (!hasSucceededMetricQuery) return "failed";

  if (queries.some(({ status }) => status === "failed")) {
    return "partially-succeeded";
  }

  return "succeeded";
}

export function getParentExperimentResultStatus(
  queries: readonly (ExperimentResultQuery & { name: string })[],
): QueryStatus {
  if (
    queries.some(({ status }) => status === "queued" || status === "running")
  ) {
    return "running";
  }
  return getExperimentResultStatus(filterParentQueryPointers(queries));
}
