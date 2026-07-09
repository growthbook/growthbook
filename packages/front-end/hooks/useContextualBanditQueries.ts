import { ApiContextualBanditQueryInterface } from "shared/validators";
import { useMemo } from "react";
import useApi from "./useApi";

/**
 * Fetches Contextual Bandit Queries (the bandit-specific assignment queries that
 * live in their own collection, not on the datasource) for a given datasource.
 */
export function useContextualBanditQueries(datasourceId?: string) {
  const path = `/api/v1/contextual-bandit-queries${
    datasourceId ? `?datasourceId=${encodeURIComponent(datasourceId)}` : ""
  }`;
  const { data, error, mutate } = useApi<{
    contextualBanditQueries: ApiContextualBanditQueryInterface[];
  }>(path, { shouldRun: () => !!datasourceId });

  const contextualBanditQueries = useMemo(
    () => data?.contextualBanditQueries ?? [],
    [data],
  );

  const contextualBanditQueriesMap = useMemo(
    () => new Map(contextualBanditQueries.map((q) => [q.id, q])),
    [contextualBanditQueries],
  );

  return {
    loading: !!datasourceId && !error && !data,
    contextualBanditQueries,
    contextualBanditQueriesMap,
    error,
    mutate,
  };
}
