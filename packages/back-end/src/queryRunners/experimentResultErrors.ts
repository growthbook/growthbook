import type { Queries, QueryInterface } from "shared/types/query";
import type { QueryMap } from "./QueryRunner";

const DEPENDENCY_FAILURE_PREFIX = "Dependencies failed";
const GENERIC_METRIC_QUERY_FAILURE =
  "A warehouse query required for this metric failed.";

function getRootCauseError(
  query: QueryInterface,
  queriesById: ReadonlyMap<string, QueryInterface>,
  visited: ReadonlySet<string>,
): string | null {
  if (query.error && !query.error.startsWith(DEPENDENCY_FAILURE_PREFIX)) {
    return query.error;
  }
  if (visited.has(query.id)) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(query.id);
  for (const dependencyId of query.dependencies ?? []) {
    const dependency = queriesById.get(dependencyId);
    if (dependency?.status !== "failed") continue;
    const error = getRootCauseError(dependency, queriesById, nextVisited);
    if (error !== null) return error;
  }
  return null;
}

export function getFailedExperimentMetricErrors({
  queryData,
  allQueryData,
  queries,
}: {
  queryData: QueryMap;
  allQueryData: QueryMap;
  queries: Queries;
}): Map<string, string> {
  const scopedQueryIds = new Set(
    Array.from(queryData.values(), (query) => query.id),
  );
  const queriesById = new Map(
    Array.from(allQueryData.values(), (query) => [query.id, query]),
  );
  const metricErrors = new Map<string, string>();

  for (const pointer of queries) {
    if (
      !pointer.resultMetricIds?.length ||
      !scopedQueryIds.has(pointer.query)
    ) {
      continue;
    }
    const query = queriesById.get(pointer.query);
    if (query?.status !== "failed") continue;

    const error =
      getRootCauseError(query, queriesById, new Set()) ??
      GENERIC_METRIC_QUERY_FAILURE;
    for (const metricId of pointer.resultMetricIds) {
      if (!metricErrors.has(metricId)) {
        metricErrors.set(metricId, error);
      }
    }
  }

  return metricErrors;
}
