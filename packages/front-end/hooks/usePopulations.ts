import { populationEndpoints } from "shared/api-endpoints";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import {
  getPopulationDateRange,
  PopulationDateRangePreset,
} from "shared/populations";
import { ApiPopulationSnapshot } from "shared/validators";
import { useRestApi, useRestApiCall } from "@/services/restApi";

const RUNNING_POLL_MS = 2000;

function pollWhileRunning(data?: {
  populationSnapshots: ApiPopulationSnapshot[];
}): number {
  return data?.populationSnapshots.some((s) => s.status === "running")
    ? RUNNING_POLL_MS
    : 0;
}

export function usePopulations(project?: string) {
  const { data, error, mutate } = useRestApi(
    populationEndpoints.listPopulations,
    {},
  );

  const populations = useMemo(
    () =>
      (data?.populations ?? []).filter((p) =>
        isProjectListValidForProject(p.projects, project),
      ),
    [data, project],
  );

  return {
    loading: !error && !data,
    populations,
    error,
    mutate,
  };
}

export function usePopulation(id: string | undefined) {
  const { data, error, mutate } = useRestApi(
    populationEndpoints.getPopulation,
    id ? { params: { id } } : null,
  );

  return {
    loading: !!id && !error && !data,
    population: data?.population,
    error,
    mutate,
  };
}

/** Each population's most recent snapshot, keyed by population id. */
export function useLatestPopulationSnapshots() {
  const { data, error, mutate } = useRestApi(
    populationEndpoints.listPopulationSnapshots,
    { query: { latest: true } },
    { refreshInterval: pollWhileRunning },
  );

  const latestSnapshots = useMemo(
    () =>
      new Map((data?.populationSnapshots ?? []).map((s) => [s.population, s])),
    [data],
  );

  return { latestSnapshots, error, mutate };
}

/**
 * The population's latest snapshot plus refresh/cancel actions. Polls while a
 * refresh is running and calls `onFinished` when it completes.
 */
export function usePopulationRefresh(
  populationId: string | undefined,
  onFinished?: () => void,
) {
  const restApiCall = useRestApiCall();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, mutate } = useRestApi(
    populationEndpoints.listPopulationSnapshots,
    populationId ? { query: { populationId, latest: true } } : null,
    { refreshInterval: pollWhileRunning },
  );
  const latest = data?.populationSnapshots[0] ?? null;
  const running = latest?.status === "running";

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) onFinished?.();
    wasRunning.current = running;
  }, [running, onFinished]);

  const refresh = useCallback(async () => {
    if (!populationId) return;
    setActionError(null);
    try {
      await restApiCall(populationEndpoints.refreshPopulation, {
        params: { id: populationId },
      });
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [populationId, restApiCall, mutate]);

  const cancel = useCallback(async () => {
    if (!populationId) return;
    setActionError(null);
    try {
      await restApiCall(populationEndpoints.cancelPopulationRefresh, {
        params: { id: populationId },
      });
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [populationId, restApiCall, mutate]);

  return {
    loading: !!populationId && !error && !data,
    latest,
    running,
    refresh,
    cancel,
    error: actionError ?? error?.message ?? null,
  };
}

/** Successful snapshots in the range, one per day, oldest first. */
export function usePopulationSnapshotHistory(
  populationId: string | undefined,
  preset: PopulationDateRangePreset,
) {
  // Computed once per preset so the request key doesn't change every render.
  const range = useMemo(() => getPopulationDateRange(preset), [preset]);
  const { data, error, mutate } = useRestApi(
    populationEndpoints.listPopulationSnapshots,
    populationId
      ? {
          query: {
            populationId,
            startDate: range.startDate.toISOString(),
          },
        }
      : null,
  );

  return {
    loading: !!populationId && !error && !data,
    snapshots: data?.populationSnapshots ?? [],
    error,
    mutate,
  };
}
