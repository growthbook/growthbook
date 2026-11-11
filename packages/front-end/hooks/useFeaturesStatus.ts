import { useCallback, useEffect, useRef, useState } from "react";
import chunk from "lodash/chunk";
import { useAuth } from "@/services/auth";

type EnvStatusMap = Record<string, boolean>;
export type EnvironmentStatusMap = Record<string, EnvStatusMap>;

// Matches usePrerequisiteStates refresh cadence.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30_000;
// The back-end rejects more than 500 ids per request; refreshes can exceed that.
const IDS_PER_REQUEST = 100;

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
      setLoading(true);
      try {
        const batches = ids !== undefined ? chunk(ids, IDS_PER_REQUEST) : [];
        const urls =
          ids !== undefined
            ? batches.map((batch) => `/features/status?ids=${batch.join(",")}`)
            : ["/features/status"];
        // Keep the batches that succeeded so one failure doesn't discard the rest
        const results = await Promise.allSettled(
          urls.map((url) => apiCall<{ features: EnvironmentStatusMap }>(url)),
        );
        const rejected = results.find(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        const incoming: EnvironmentStatusMap = Object.assign(
          {},
          ...results.map((r) =>
            r.status === "fulfilled" ? (r.value.features ?? {}) : {},
          ),
        );
        if (ids === undefined) {
          if (rejected) throw rejected.reason;
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => loadedIds.current.add(id));
          setEnvironmentStatus(incoming);
        } else {
          // Mark ALL requested IDs as loaded, not just ones returned by the server.
          // IDs absent from the response are permission-filtered or don't exist.
          results.forEach((r, i) => {
            if (r.status === "fulfilled") {
              batches[i].forEach((id) => loadedIds.current.add(id));
            }
          });
          setEnvironmentStatus((prev) => ({ ...prev, ...incoming }));
          if (rejected) throw rejected.reason;
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
  // cancelled flag prevents rescheduling after unmount, even if a fetch was in-flight.
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (delay = REFRESH_INTERVAL_MS) => {
      id = setTimeout(async () => {
        if (cancelled) return;
        let failed = false;
        if (loadedIds.current.size) {
          try {
            await (hasFetchedAll.current
              ? doFetch()
              : doFetch([...loadedIds.current]));
          } catch {
            failed = true;
          }
        }
        if (!cancelled) schedule(failed ? ERROR_RETRY_MS : REFRESH_INTERVAL_MS);
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
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
          body: JSON.stringify({ environments: { [envId]: state } }),
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
