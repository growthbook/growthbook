import { useCallback, useEffect, useRef, useState } from "react";
import chunk from "lodash/chunk";
import { useAuth } from "@/services/auth";

export type RampStateEntry = { id: string; name: string; status: string };
type RampStateCache = Record<string, RampStateEntry>;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30_000;
// The back-end rejects more than 500 ids per request; refreshes can exceed that.
const IDS_PER_REQUEST = 100;

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
      setLoading(true);
      try {
        const batches = ids !== undefined ? chunk(ids, IDS_PER_REQUEST) : [];
        const urls =
          ids !== undefined
            ? batches.map(
                (batch) => `/features/ramp-states?ids=${batch.join(",")}`,
              )
            : ["/features/ramp-states"];
        // Keep the batches that succeeded so one failure doesn't discard the rest
        const results = await Promise.allSettled(
          urls.map((url) => apiCall<{ features: RampStateCache }>(url)),
        );
        const incoming: RampStateCache = Object.assign(
          {},
          ...results.map((r) =>
            r.status === "fulfilled" ? (r.value.features ?? {}) : {},
          ),
        );
        if (ids === undefined) {
          if (results[0].status === "rejected") return;
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => cachedIds.current.add(id));
          setRampStates(incoming);
        } else {
          results.forEach((r, i) => {
            if (r.status === "fulfilled") {
              batches[i].forEach((id) => cachedIds.current.add(id));
            }
          });
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
