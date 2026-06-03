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

  // Map view for O(1) lookups from id → CB (used by ContextualBanditLink
  // and any other resolver that has only an id in hand).
  const contextualBanditsMap = useMemo(
    () => new Map(allContextualBandits.map((cb) => [cb.id, cb])),
    [allContextualBandits],
  );

  // Parallel index keyed by the paired experiment FK so callers that
  // only have an experiment id (e.g. the detail page at
  // /contextual-bandit/[cbid] which is keyed by experiment id during the
  // decoupling window) can resolve to a CB. Skips entries without an
  // `experiment` field (orphaned post-PR-8). Drop the experiment-side
  // index when PR-8 removes the FK; everything will key by cb.id only.
  const contextualBanditsByExperimentMap = useMemo(
    () =>
      new Map(
        allContextualBandits
          .filter((cb) => !!cb.experiment)
          .map((cb) => [cb.experiment as string, cb]),
      ),
    [allContextualBandits],
  );

  return {
    loading: !error && !data,
    contextualBandits,
    contextualBanditsMap,
    contextualBanditsByExperimentMap,
    error,
    mutate,
    hasArchived: allContextualBandits.some((cb) => cb.archived),
  };
}

/**
 * Resolve a CB doc from a paired experiment id. Used by the detail page
 * (URL still keyed by experiment id) so the page can read CB-native
 * fields alongside the existing experiment fetch.
 *
 * Returns `undefined` while the list is still loading or when no CB
 * is paired with the experiment.
 */
export function useContextualBanditByExperiment(
  experimentId: string | undefined,
) {
  const { contextualBanditsByExperimentMap, loading } = useContextualBandits();
  if (!experimentId || loading) return undefined;
  return contextualBanditsByExperimentMap?.get(experimentId);
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
