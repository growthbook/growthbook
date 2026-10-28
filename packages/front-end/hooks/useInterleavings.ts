import {
  interleavingEndpoints,
  interleavingExposureQueryEndpoints,
} from "shared/api-endpoints";
import { useCallback, useState } from "react";
import { useRestApi, useRestApiCall } from "@/services/restApi";
import {
  useCoherentLatest,
  useRefetchHeavyOnStatusSuccess,
} from "@/hooks/useCoherentSnapshotStatus";

export function useInterleavings(
  project?: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { data, error, mutate } = useRestApi(
    interleavingEndpoints.listInterleavings,
    enabled ? { query: { projectId: project || undefined } } : null,
  );
  return {
    loading: enabled && !error && !data,
    interleavings: data?.interleavings ?? [],
    error,
    mutate,
  };
}

export function useInterleaving(
  id: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { data, error, mutate } = useRestApi(
    interleavingEndpoints.getInterleaving,
    id && enabled ? { params: { id } } : null,
  );
  return {
    loading: !!id && enabled && !error && !data,
    interleaving: data?.interleaving,
    error,
    mutate,
  };
}

export function useInterleavingResults(id: string | undefined) {
  const restApiCall = useRestApiCall();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const {
    data: heavyData,
    error,
    isValidating,
    mutate: mutateHeavy,
  } = useRestApi(
    interleavingEndpoints.getInterleavingResults,
    id ? { params: { id } } : null,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const {
    data: statusData,
    error: statusError,
    mutate: mutateStatus,
  } = useRestApi(
    interleavingEndpoints.getInterleavingStatus,
    id ? { params: { id } } : null,
    {
      refreshInterval: (d) =>
        d?.latest?.status === "running" || d?.latest?.status === "pending"
          ? 2000
          : 0,
    },
  );

  const snapshot = heavyData?.snapshot ?? null;
  const statusLatest = statusData?.latest ?? null;
  const heavyLatest = heavyData?.latest ?? null;
  const heavyCaughtUp =
    statusLatest?.status === "success" &&
    heavyLatest?.id === statusLatest.id &&
    heavyLatest?.status === "success";

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

  const refresh = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await restApiCall(interleavingEndpoints.refreshInterleaving, {
        params: { id },
      });
      await mutateStatus();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [restApiCall, id, mutateStatus]);

  return {
    loading: !!id && !error && !heavyData,
    snapshot,
    latest,
    running: latest?.status === "running" || latest?.status === "pending",
    error,
    statusError,
    mutate,
    refresh,
    refreshing,
    refreshError,
  };
}

export function useInterleavingExposureQueries(datasourceId: string) {
  const { data, error, mutate } = useRestApi(
    interleavingExposureQueryEndpoints.listInterleavingExposureQueries,
    datasourceId ? { query: { datasourceId } } : null,
  );
  return {
    loading: !!datasourceId && !error && !data,
    exposureQueries: data?.interleavingExposureQueries ?? [],
    error,
    mutate,
  };
}
