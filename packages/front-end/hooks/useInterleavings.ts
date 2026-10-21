import {
  interleavingEndpoints,
  interleavingExposureQueryEndpoints,
} from "shared/api-endpoints";
import { useCallback, useEffect, useState } from "react";
import { useRestApi, useRestApiCall } from "@/services/restApi";

export function useInterleavings(project?: string) {
  const { data, error, mutate } = useRestApi(
    interleavingEndpoints.listInterleavings,
    { query: { projectId: project || undefined } },
  );
  return {
    loading: !error && !data,
    interleavings: data?.interleavings ?? [],
    error,
    mutate,
  };
}

export function useInterleaving(id: string | undefined) {
  const { data, error, mutate } = useRestApi(
    interleavingEndpoints.getInterleaving,
    id ? { params: { id } } : null,
  );
  return {
    loading: !!id && !error && !data,
    interleaving: data?.interleaving,
    error,
    mutate,
  };
}

/** Latest results snapshot; polls while its queries are running. */
export function useInterleavingResults(id: string | undefined) {
  const restApiCall = useRestApiCall();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const { data, error, mutate } = useRestApi(
    interleavingEndpoints.getInterleavingResults,
    id ? { params: { id } } : null,
  );
  const snapshot = data?.snapshot ?? null;
  const isRunning = snapshot?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => void mutate(), 2000);
    return () => clearInterval(timer);
  }, [isRunning, mutate]);

  const refresh = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await restApiCall(interleavingEndpoints.refreshInterleaving, {
        params: { id },
      });
      await mutate();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [restApiCall, id, mutate]);

  return {
    loading: !!id && !error && !data,
    snapshot,
    error,
    refresh,
    refreshing,
    refreshError,
  };
}

export function useInterleavingExposureQueries(datasourceId: string) {
  const { data, error } = useRestApi(
    interleavingExposureQueryEndpoints.listInterleavingExposureQueries,
    datasourceId ? { query: { datasourceId } } : null,
  );
  return {
    loading: !!datasourceId && !error && !data,
    exposureQueries: data?.interleavingExposureQueries ?? [],
    error,
  };
}
