import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";

type EnvStatusMap = Record<string, boolean>;
export type EnvironmentStatusMap = Record<string, EnvStatusMap>;

// Matches usePrerequisiteStates refresh cadence.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface UseFeaturesStatusReturn {
  // Skips already-loaded IDs; no-op if fetchAll has already run.
  fetchSome: (featureIds: string[]) => Promise<void>;
  // Fetches all org features, overwriting the current data.
  fetchAll: () => Promise<void>;
  // Reads enabled state from environmentStatus.
  getStatus: (featureId: string, envId: string) => boolean | undefined;
  // Optimistic toggle: updates environmentStatus immediately, reconciles on failure.
  toggle: (featureId: string, envId: string, state: boolean) => Promise<void>;
  loading: boolean;
  environmentStatus: EnvironmentStatusMap;
}

export function useFeaturesStatus(): UseFeaturesStatusReturn {
  const { apiCall } = useAuth();
  const [environmentStatus, setEnvironmentStatus] =
    useState<EnvironmentStatusMap>({});
  const loadedIds = useRef(new Set<string>());
  const hasFetchedAll = useRef(false);
  const [loading, setLoading] = useState(false);
  // Prevents concurrent duplicate fetches (e.g. React Strict Mode double-invocation).
  const inflightKey = useRef<string | null>(null);

  // Internal: always hits the API regardless of loaded state.
  // ids = undefined → fetch all; ids = [] → no-op.
  const doFetch = useCallback(
    async (ids?: string[]) => {
      if (ids !== undefined && !ids.length) return;
      const key = ids === undefined ? "__all__" : [...ids].sort().join(",");
      if (inflightKey.current === key) return;
      inflightKey.current = key;
      const url =
        ids !== undefined
          ? `/features/status?ids=${ids.join(",")}`
          : "/features/status";
      setLoading(true);
      try {
        const res = await apiCall<{ features: EnvironmentStatusMap }>(url);
        const incoming = res.features ?? {};
        if (ids === undefined) {
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => loadedIds.current.add(id));
          setEnvironmentStatus(incoming);
        } else {
          // Mark ALL requested IDs as loaded, not just ones returned by the server.
          // IDs absent from the response are permission-filtered or don't exist.
          ids.forEach((id) => loadedIds.current.add(id));
          setEnvironmentStatus((prev) => ({ ...prev, ...incoming }));
        }
      } finally {
        setLoading(false);
        inflightKey.current = null;
      }
    },
    [apiCall],
  );

  const fetchSome = useCallback(
    async (featureIds: string[]) => {
      if (hasFetchedAll.current) return;
      const unloaded = featureIds.filter((id) => !loadedIds.current.has(id));
      await doFetch(unloaded);
    },
    [doFetch],
  );

  const fetchAll = useCallback(() => doFetch(), [doFetch]);

  // Periodically refresh whatever has already been loaded.
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(async () => {
        if (loadedIds.current.size) {
          await (hasFetchedAll.current
            ? doFetch()
            : doFetch([...loadedIds.current]));
        }
        schedule();
      }, REFRESH_INTERVAL_MS);
    };
    schedule();
    return () => clearTimeout(id);
  }, [doFetch]);

  const getStatus = useCallback(
    (featureId: string, envId: string): boolean | undefined =>
      environmentStatus[featureId]?.[envId],
    [environmentStatus],
  );

  const toggle = useCallback(
    async (featureId: string, envId: string, state: boolean) => {
      setEnvironmentStatus((prev) => ({
        ...prev,
        [featureId]: { ...(prev[featureId] ?? {}), [envId]: state },
      }));

      try {
        await apiCall(`/feature/${featureId}/toggle`, {
          method: "POST",
          body: JSON.stringify({ environment: envId, state }),
        });
      } catch (e) {
        await doFetch([featureId]);
        throw e;
      }
    },
    [apiCall, doFetch],
  );

  return { fetchSome, fetchAll, getStatus, toggle, loading, environmentStatus };
}
