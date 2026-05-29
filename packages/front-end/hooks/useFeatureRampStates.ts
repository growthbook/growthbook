import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";

export type RampStateEntry = { id: string; name: string; status: string };
type RampStateCache = Record<string, RampStateEntry>;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30_000;

export interface UseFeatureRampStatesReturn {
  rampStates: RampStateCache;
  fetchSome: (featureIds: string[]) => Promise<void>;
  fetchAll: () => Promise<void>;
  loading: boolean;
}

export function useFeatureRampStates(): UseFeatureRampStatesReturn {
  const { apiCall } = useAuth();
  const [rampStates, setRampStates] = useState<RampStateCache>({});
  const cachedIds = useRef(new Set<string>());
  const hasFetchedAll = useRef(false);
  const [loading, setLoading] = useState(false);
  const inflightKey = useRef<string | null>(null);

  const doFetch = useCallback(
    async (ids?: string[]) => {
      if (ids !== undefined && !ids.length) return;
      const key = ids === undefined ? "__all__" : [...ids].sort().join(",");
      if (inflightKey.current === key) return;
      inflightKey.current = key;
      const url =
        ids !== undefined
          ? `/features/ramp-states?ids=${ids.join(",")}`
          : "/features/ramp-states";
      setLoading(true);
      try {
        const res = await apiCall<{ features: RampStateCache }>(url);
        const incoming = res.features ?? {};
        if (ids === undefined) {
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => cachedIds.current.add(id));
          setRampStates(incoming);
        } else {
          ids.forEach((id) => cachedIds.current.add(id));
          setRampStates((prev) => ({ ...prev, ...incoming }));
        }
      } catch {
        // leave state unchanged so the filter can retry on next activation
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
      const uncached = featureIds.filter((id) => !cachedIds.current.has(id));
      await doFetch(uncached);
    },
    [doFetch],
  );

  const fetchAll = useCallback(() => doFetch(), [doFetch]);

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (delay = REFRESH_INTERVAL_MS) => {
      id = setTimeout(async () => {
        if (cancelled) return;
        let failed = false;
        if (cachedIds.current.size) {
          try {
            await (hasFetchedAll.current
              ? doFetch()
              : doFetch([...cachedIds.current]));
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

  return { rampStates, fetchSome, fetchAll, loading };
}
