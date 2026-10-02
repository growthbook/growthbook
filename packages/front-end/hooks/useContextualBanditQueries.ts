import { contextualBanditQueryEndpoints } from "shared/api-endpoints";
import { useMemo } from "react";
import { useRestApi } from "@/services/restApi";

/**
 * Fetches Contextual Bandit Queries (the bandit-specific assignment queries that
 * live in their own collection, not on the datasource) for a given datasource.
 */
export function useContextualBanditQueries(datasourceId?: string) {
  const { data, error, mutate } = useRestApi(
    contextualBanditQueryEndpoints.listContextualBanditQueries,
    datasourceId ? { query: { datasourceId } } : null,
  );

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
