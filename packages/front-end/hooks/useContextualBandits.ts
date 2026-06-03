import { ApiContextualBanditInterface } from "shared/validators";
import { useMemo } from "react";
import useApi from "./useApi";

/**
 * Fetches CB docs from the REST API (`/api/v1/contextual-bandits`).
 *
 * Returns the API shape (`ApiContextualBanditInterface[]`) directly.
 * Earlier in PR-6 this hook also produced an experiment-shaped
 * projection so the list page could keep using `useExperimentSearch`
 * unchanged; that projection has been removed now that
 * `useContextualBanditSearch` consumes CB-native types.
 */
export function useContextualBandits(
  project?: string,
  includeArchived: boolean = false,
) {
  // The REST list endpoint supports projectId filtering server-side; the
  // archived flag is applied client-side because the BaseModel CRUD list
  // doesn't expose an `archived` filter yet.
  const path = `/contextual-bandits${project ? `?projectId=${encodeURIComponent(project)}` : ""}`;
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

  return {
    loading: !error && !data,
    contextualBandits,
    error,
    mutate,
    hasArchived: allContextualBandits.some((cb) => cb.archived),
  };
}

/**
 * Single-CB fetch via `GET /api/v1/contextual-bandits/:id` (the standard
 * CRUD endpoint added in PR-4). Returns the API-shape directly — no
 * experiment-shape projection because callers of this hook are
 * specifically opting into the CB-native surface.
 *
 * Building block for the PR-6 detail-page fork: once the detail page
 * stops fetching `/experiment/${cbid}` and reads CB-native fields off
 * this hook, the parent-experiment indirection (and its dependent
 * components like SnapshotProvider, TabbedPage) can be refactored to
 * accept a CB doc directly.
 */
export function useContextualBandit(cbId: string | undefined) {
  const { data, error, mutate } = useApi<{
    contextualBandit: ApiContextualBanditInterface;
  }>(cbId ? `/contextual-bandits/${cbId}` : "/contextual-bandits/__missing__", {
    shouldRun: () => !!cbId,
  });

  return {
    loading: !!cbId && !error && !data,
    contextualBandit: data?.contextualBandit,
    error,
    mutate,
  };
}
