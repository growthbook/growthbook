import { contextualBanditEndpoints } from "shared/api-endpoints";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LinkedFeatureInfo } from "shared/types/experiment";
import { useRestApi, useRestApiCall } from "@/services/restApi";

/** Fetches CB docs from the REST API and returns the API shape directly. */
export function useContextualBandits(
  project?: string,
  includeArchived: boolean = false,
) {
  const { data, error, mutate } = useRestApi(
    contextualBanditEndpoints.listContextualBandits,
    {
      query: { projectId: project || undefined },
    },
  );

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
  const { data, error, mutate } = useRestApi(
    contextualBanditEndpoints.getContextualBandit,
    cbId ? { params: { id: cbId } } : null,
  );

  return {
    loading: !!cbId && !error && !data,
    contextualBandit: data?.contextualBandit,
    error,
    mutate,
  };
}

/**
 * CB-native results state: fetches the CB results snapshot, auto-polls while a run is in progress,
 * and exposes a refresh action. Replaces the experiment `useSnapshot()` context for CBs.
 */
export function useContextualBanditResults(cbId: string | undefined) {
  const restApiCall = useRestApiCall();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const { data, error, mutate, isValidating } = useRestApi(
    contextualBanditEndpoints.getContextualBanditResults,
    cbId ? { params: { id: cbId } } : null,
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
      await restApiCall(contextualBanditEndpoints.refreshContextualBandit, {
        params: { id: cbId },
      });
      await mutate();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [restApiCall, cbId, mutate]);

  const cancel = useCallback(async () => {
    if (!cbId) return;
    await restApiCall(contextualBanditEndpoints.cancelContextualBandit, {
      params: { id: cbId },
    });
  }, [restApiCall, cbId]);

  return {
    loading: !!cbId && !error && !data,
    isValidating,
    contextualBanditSnapshot: data?.contextualBanditSnapshot ?? null,
    results: data?.results ?? null,
    latest,
    error,
    mutate,
    refresh,
    cancel,
    refreshing,
    refreshError,
    setRefreshError,
  };
}

/** Fetches the features linked to a CB (enriched `LinkedFeatureInfo[]`) for the Linked Features section. */
export function useContextualBanditLinkedFeatures(cbId: string | undefined) {
  const { data, error, mutate } = useRestApi(
    contextualBanditEndpoints.getContextualBanditLinkedFeatures,
    cbId ? { params: { id: cbId } } : null,
  );

  return {
    loading: !!cbId && !error && !data,
    // The REST schema leaves each entry untyped; the handler returns
    // getContextualBanditLinkedFeatureInfo() output, i.e. LinkedFeatureInfo.
    linkedFeatures: (data?.linkedFeatures ?? []) as LinkedFeatureInfo[],
    environments: data?.environments ?? [],
    error,
    mutate,
  };
}
