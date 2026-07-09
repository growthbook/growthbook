import { ApiContextualBanditInterface } from "shared/validators";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SnapshotStatusSummary } from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import type { ContextualBanditResultsView } from "shared/experiments";
import type { LinkedFeatureInfo } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import useApi from "./useApi";

/** Fetches CB docs from the REST API and returns the API shape directly. */
export function useContextualBandits(
  project?: string,
  includeArchived: boolean = false,
) {
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

export type ContextualBanditResultsResponse = {
  status: number;
  contextualBanditSnapshot: ContextualBanditSnapshot | null;
  overallWeights: { variationId: string; weight: number | null }[] | null;
  results: ContextualBanditResultsView | null;
  latest: SnapshotStatusSummary | null;
};

/**
 * CB-native results state: fetches the CB results snapshot, auto-polls while a run is in progress,
 * and exposes a refresh action. Replaces the experiment `useSnapshot()` context for CBs.
 */
export function useContextualBanditResults(cbId: string | undefined) {
  const { apiCall } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const { data, error, mutate } = useApi<ContextualBanditResultsResponse>(
    cbId
      ? `/api/v1/contextual-bandits/${cbId}/results`
      : "/api/v1/contextual-bandits/__missing__/results",
    { shouldRun: () => !!cbId },
  );

  const latest = data?.latest ?? null;
  const isRunning = latest?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      void mutate();
    }, 2000);
    return () => clearInterval(timer);
  }, [isRunning, mutate]);

  const refresh = useCallback(async () => {
    if (!cbId) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await apiCall<{ snapshotId: string; cbeId?: string }>(
        `/api/v1/contextual-bandits/${cbId}/refresh`,
        { method: "POST" },
      );
      await mutate();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [apiCall, cbId, mutate]);

  return {
    loading: !!cbId && !error && !data,
    contextualBanditSnapshot: data?.contextualBanditSnapshot ?? null,
    results: data?.results ?? null,
    latest,
    error,
    mutate,
    refresh,
    refreshing,
    refreshError,
    setRefreshError,
  };
}

export type ContextualBanditLinkedFeaturesResponse = {
  linkedFeatures: LinkedFeatureInfo[];
  environments: string[];
};

/** Fetches the features linked to a CB (enriched `LinkedFeatureInfo[]`) for the Linked Features section. */
export function useContextualBanditLinkedFeatures(cbId: string | undefined) {
  const { data, error, mutate } =
    useApi<ContextualBanditLinkedFeaturesResponse>(
      cbId
        ? `/api/v1/contextual-bandits/${cbId}/linked-features`
        : "/api/v1/contextual-bandits/__missing__/linked-features",
      { shouldRun: () => !!cbId },
    );

  return {
    loading: !!cbId && !error && !data,
    linkedFeatures: data?.linkedFeatures ?? [],
    environments: data?.environments ?? [],
    error,
    mutate,
  };
}
