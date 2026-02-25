import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";

type EnvStatusMap = Record<string, boolean>;
type StatusCache = Record<string, EnvStatusMap>;

// Matches usePrerequisiteStates refresh cadence.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface UseFeaturesStatusReturn {
  // Skips already-cached IDs; no-op if fetchAll has already run.
  fetchSome: (featureIds: string[]) => Promise<void>;
  // Fetches all org features, overwriting the cache.
  fetchAll: () => Promise<void>;
  // Reads enabled state from the cache.
  getStatus: (featureId: string, envId: string) => boolean | undefined;
  // Optimistic toggle: updates cache immediately, reconciles from server on failure.
  toggle: (featureId: string, envId: string, state: boolean) => Promise<void>;
  loading: boolean;
  cache: StatusCache;
}

export function useFeaturesStatus(): UseFeaturesStatusReturn {
  const { apiCall } = useAuth();
  const [cache, setCache] = useState<StatusCache>({});
  const cachedIds = useRef(new Set<string>());
  const hasFetchedAll = useRef(false);
  const [loading, setLoading] = useState(false);

  const mergeIntoCache = useCallback((incoming: StatusCache) => {
    Object.keys(incoming).forEach((id) => cachedIds.current.add(id));
    setCache((prev) => ({ ...prev, ...incoming }));
  }, []);

  // Internal: always hits the API regardless of cache state.
  // ids = undefined → fetch all; ids = [] → no-op.
  const doFetch = useCallback(
    async (ids?: string[]) => {
      if (ids !== undefined && !ids.length) return;
      const url =
        ids !== undefined
          ? `/features/status?ids=${encodeURIComponent(ids.join(","))}`
          : "/features/status";
      setLoading(true);
      try {
        const res = await apiCall<{ features: StatusCache }>(url);
        const incoming = res.features ?? {};
        if (ids === undefined) {
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => cachedIds.current.add(id));
          setCache(incoming);
        } else {
          mergeIntoCache(incoming);
        }
      } finally {
        setLoading(false);
      }
    },
    [apiCall, mergeIntoCache],
  );

  const fetchSome = useCallback(
    async (featureIds: string[]) => {
      if (hasFetchedAll.current) return;
      const uncached = featureIds.filter((id) => !cachedIds.current.has(id));
      await doFetch(uncached);
    },
    [doFetch],
  );

  const fetchAll = useCallback(() => doFetch(), [doFetch]);

  // Periodically refresh whatever has already been loaded.
  // Uses recursive setTimeout so a slow request doesn't stack with the next tick.
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(async () => {
        if (cachedIds.current.size) {
          await (hasFetchedAll.current
            ? doFetch()
            : doFetch([...cachedIds.current]));
        }
        schedule();
      }, REFRESH_INTERVAL_MS);
    };
    schedule();
    return () => clearTimeout(id);
  }, [doFetch]);

  const getStatus = useCallback(
    (featureId: string, envId: string): boolean | undefined =>
      cache[featureId]?.[envId],
    [cache],
  );

  const toggle = useCallback(
    async (featureId: string, envId: string, state: boolean) => {
      setCache((prev) => ({
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

  return { fetchSome, fetchAll, getStatus, toggle, loading, cache };
}
