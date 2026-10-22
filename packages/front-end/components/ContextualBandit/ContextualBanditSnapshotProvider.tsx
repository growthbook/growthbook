import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { contextualBanditEndpoints } from "shared/api-endpoints";
import { z } from "zod";
import { useRestApi, useRestApiCall } from "@/services/restApi";

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
  error?: Error;
  /** Refetch both the cheap status and the heavy results. */
  mutate: () => Promise<unknown>;
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
    refresh: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    refreshing: false,
    refreshError: "",
    setRefreshError: noop,
  });

function useRefetchHeavyOnStatusSuccess(
  statusLatest: LatestStatus,
  heavyLatestId: string | undefined,
  heavyIsValidating: boolean,
  refetchHeavy: () => Promise<unknown>,
): void {
  useEffect(() => {
    if (statusLatest?.status !== "success") return;
    if (heavyIsValidating) return;
    if (statusLatest.id !== heavyLatestId) void refetchHeavy();
  }, [
    statusLatest?.id,
    statusLatest?.status,
    heavyLatestId,
    heavyIsValidating,
    refetchHeavy,
  ]);
}

function useCoherentLatest(
  statusLatest: LatestStatus,
  heavyLatestId: string | undefined,
): LatestStatus {
  const heavyAgrees =
    !statusLatest ||
    statusLatest.status !== "success" ||
    statusLatest.id === heavyLatestId;
  const [held, setHeld] = useState<LatestStatus>(null);
  useEffect(() => {
    if (!heavyAgrees) return;
    setHeld((prev) =>
      prev?.id === statusLatest?.id && prev?.status === statusLatest?.status
        ? prev
        : statusLatest,
    );
  }, [heavyAgrees, statusLatest]);
  return heavyAgrees ? statusLatest : held;
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
  const { data: statusData, mutate: mutateStatus } = useRestApi(
    contextualBanditEndpoints.getContextualBanditStatus,
    cbId ? { params: { id: cbId } } : null,
    {
      refreshInterval: (d) => (d?.latest?.status === "running" ? 2000 : 0),
    },
  );

  const statusLatest = statusData?.latest ?? null;
  const heavyLatestId = heavyData?.latest?.id;

  useRefetchHeavyOnStatusSuccess(
    statusLatest,
    heavyLatestId,
    isValidating,
    mutateHeavy,
  );
  const latest = useCoherentLatest(statusLatest, heavyLatestId);

  const mutate = useCallback(
    () => Promise.all([mutateStatus(), mutateHeavy()]),
    [mutateStatus, mutateHeavy],
  );

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
        mutate,
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
