import { ApiContextualBanditInterface } from "shared/validators";
import { useMemo } from "react";
import useApi from "./useApi";

/** Fetches CB docs from the REST API and returns the API shape directly. */
export function useContextualBandits(
  project?: string,
  includeArchived: boolean = false,
) {
  // Archived filter is client-side; BaseModel CRUD list doesn't support it yet.
  const path = `/api/v1/contextual-bandits${project ? `?projectId=${encodeURIComponent(project)}` : ""}`;
  const { data, error, mutate } = useApi<{
    contextualBandits: ApiContextualBanditInterface[];
  }>(path);

  const allContextualBandits = useMemo(
    () => data?.contextualBandits ?? [],
    [data],
  );

  const contextualBandits = useMemo(
    () =>
      includeArchived
        ? allContextualBandits
        : allContextualBandits.filter((cb) => !cb.archived),
    [allContextualBandits, includeArchived],
  );

  // O(1) id → CB lookup for resolvers like ContextualBanditLink.
  const contextualBanditsMap = useMemo(
    () => new Map(allContextualBandits.map((cb) => [cb.id, cb])),
    [allContextualBandits],
  );

  return {
    loading: !error && !data,
    contextualBandits,
    contextualBanditsMap,
    error,
    mutate,
    hasArchived: allContextualBandits.some((cb) => cb.archived),
  };
}

/** Single-CB fetch returning the CB-native API shape. */
export function useContextualBandit(cbId: string | undefined) {
  const { data, error, mutate } = useApi<{
    contextualBandit: ApiContextualBanditInterface;
  }>(
    cbId
      ? `/api/v1/contextual-bandits/${cbId}`
      : "/api/v1/contextual-bandits/__missing__",
    {
      shouldRun: () => !!cbId,
    },
  );

  return {
    loading: !!cbId && !error && !data,
    contextualBandit: data?.contextualBandit,
    error,
    mutate,
  };
}
