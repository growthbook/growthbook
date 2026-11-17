import React, { ReactNode, useCallback, useContext, useState } from "react";
import { contextualBanditEndpoints } from "shared/api-endpoints";
import { z } from "zod";
import { useRestApi, useRestApiCall } from "@/services/restApi";
import {
  useCoherentLatest,
  useRefetchHeavyOnStatusSuccess,
} from "@/hooks/useCoherentSnapshotStatus";

type ResultsResponse = z.infer<
  typeof contextualBanditEndpoints.getContextualBanditResults.responseSchema
>;
type LatestStatus = ResultsResponse["latest"];

type ContextualBanditSnapshotContextValue = {
  cbId?: string;
  loading: boolean;
  isValidating: boolean;
  contextualBanditSnapshot: ResultsResponse["contextualBanditSnapshot"];
  overallWeights: ResultsResponse["overallWeights"];
  results: ResultsResponse["results"];
  latest: LatestStatus;
  /** Error from the heavy results fetch. */
  error?: Error;
  statusError?: Error;
  /** Refetch both the cheap status and the heavy results. */
  mutate: () => Promise<unknown>;
  refreshStatus: () => Promise<unknown>;
  /** Trigger a new run, then pull the cheap status (heavy upgrades on success). */
  refresh: () => Promise<void>;
  /** Cancel the in-progress run, then pull the cheap status. */
  cancel: () => Promise<void>;
  refreshing: boolean;
  refreshError: string;
  setRefreshError: (value: string) => void;
};

const noop = () => {
  // do nothing
};

const contextualBanditSnapshotContext =
  React.createContext<ContextualBanditSnapshotContextValue>({
    loading: false,
    isValidating: false,
    contextualBanditSnapshot: null,
    overallWeights: null,
    results: null,
    latest: null,
    mutate: () => Promise.resolve(),
    refreshStatus: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    refreshing: false,
    refreshError: "",
    setRefreshError: noop,
  });

function heavyReflectsSuccess(
  statusLatest: LatestStatus,
  heavyLatest: LatestStatus,
): boolean {
  return (
    statusLatest?.status === "success" &&
    heavyLatest?.id === statusLatest.id &&
    heavyLatest?.status === "success"
  );
}

export default function ContextualBanditSnapshotProvider({
  cbId,
  children,
}: {
  cbId: string | undefined;
  children: ReactNode;
}) {
  const restApiCall = useRestApiCall();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const {
    data: heavyData,
    error,
    isValidating,
    mutate: mutateHeavy,
  } = useRestApi(
    contextualBanditEndpoints.getContextualBanditResults,
    cbId ? { params: { id: cbId } } : null,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  // Cheap status fetch. Polls every 2s only while a run is in progress.
  const {
    data: statusData,
    error: statusError,
    mutate: mutateStatus,
  } = useRestApi(
    contextualBanditEndpoints.getContextualBanditStatus,
    cbId ? { params: { id: cbId } } : null,
    {
      refreshInterval: (d) => (d?.latest?.status === "running" ? 2000 : 0),
    },
  );

  const statusLatest = statusData?.latest ?? null;
  const heavyLatest = heavyData?.latest ?? null;
  const heavyCaughtUp = heavyReflectsSuccess(statusLatest, heavyLatest);

  useRefetchHeavyOnStatusSuccess(
    statusLatest,
    heavyCaughtUp,
    isValidating,
    mutateHeavy,
  );
  const latest = useCoherentLatest(statusLatest, heavyCaughtUp) ?? null;

  const mutate = useCallback(
    () => Promise.all([mutateStatus(), mutateHeavy()]),
    [mutateStatus, mutateHeavy],
  );

  const refreshStatus = useCallback(() => mutateStatus(), [mutateStatus]);

  const refresh = useCallback(async () => {
    if (!cbId) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await restApiCall(contextualBanditEndpoints.refreshContextualBandit, {
        params: { id: cbId },
      });
      await mutateStatus();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [restApiCall, cbId, mutateStatus]);

  const cancel = useCallback(async () => {
    if (!cbId) return;
    await restApiCall(contextualBanditEndpoints.cancelContextualBandit, {
      params: { id: cbId },
    });
    await mutateStatus();
  }, [restApiCall, cbId, mutateStatus]);

  return (
    <contextualBanditSnapshotContext.Provider
      value={{
        cbId,
        loading: !!cbId && !error && !heavyData,
        isValidating,
        contextualBanditSnapshot: heavyData?.contextualBanditSnapshot ?? null,
        overallWeights: heavyData?.overallWeights ?? null,
        results: heavyData?.results ?? null,
        latest,
        error,
        statusError,
        mutate,
        refreshStatus,
        refresh,
        cancel,
        refreshing,
        refreshError,
        setRefreshError,
      }}
    >
      {children}
    </contextualBanditSnapshotContext.Provider>
  );
}

export function useContextualBanditSnapshot() {
  return useContext(contextualBanditSnapshotContext);
}
