import { ApiInterleavingQueryInterface } from "shared/validators";
import { useMemo } from "react";
import useApi from "./useApi";

/**
 * Fetches Interleaving Queries (the interleaving-specific exposure queries
 * that live in their own collection, not on the datasource), optionally
 * scoped to a datasource.
 */
export function useInterleavingQueries(datasourceId?: string) {
  const path = `/api/v1/interleaving-queries${
    datasourceId ? `?datasourceId=${encodeURIComponent(datasourceId)}` : ""
  }`;
  const { data, error, mutate } = useApi<{
    interleavingQueries: ApiInterleavingQueryInterface[];
  }>(path, { shouldRun: () => !!datasourceId });

  const interleavingQueries = useMemo(
    () => data?.interleavingQueries ?? [],
    [data],
  );

  const interleavingQueriesMap = useMemo(
    () => new Map(interleavingQueries.map((q) => [q.id, q])),
    [interleavingQueries],
  );

  return {
    loading: !!datasourceId && !error && !data,
    interleavingQueries,
    interleavingQueriesMap,
    error,
    mutate,
  };
}
