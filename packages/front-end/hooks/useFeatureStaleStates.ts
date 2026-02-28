import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
  createElement,
} from "react";
import { IsFeatureStaleResult } from "shared/util";
import { useAuth } from "@/services/auth";

export type StaleStateEntry = IsFeatureStaleResult & {
  neverStale: boolean;
  computedAt: string;
};
export type StaleStateMap = Record<string, StaleStateEntry>;

const ENTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes per entry
const ERROR_RETRY_MS = 30_000;

export interface UseFeatureStaleStatesReturn {
  // Skips already-loaded IDs whose TTL hasn't expired; no-op if fetchAll has already run.
  fetchSome: (featureIds: string[]) => Promise<void>;
  // Fetches all org features, overwriting the current data.
  fetchAll: () => Promise<void>;
  // Removes specific IDs from the cache so the next fetchSome re-fetches them.
  invalidate: (ids: string[]) => void;
  getStaleState: (featureId: string) => StaleStateEntry | undefined;
  loading: boolean;
  staleStates: StaleStateMap;
}

const StaleStatesContext = createContext<UseFeatureStaleStatesReturn | null>(
  null,
);

export function FeatureStaleStatesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const [staleStates, setStaleStates] = useState<StaleStateMap>({});
  const loadedIds = useRef(new Set<string>());
  const entryTimestamps = useRef<Record<string, number>>({});
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
          ? `/features/stale?ids=${ids.join(",")}`
          : "/features/stale";
      setLoading(true);
      try {
        const res = await apiCall<{ features: StaleStateMap }>(url);
        const incoming = res.features ?? {};
        const now = Date.now();
        if (ids === undefined) {
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => {
            loadedIds.current.add(id);
            entryTimestamps.current[id] = now;
          });
          setStaleStates(incoming);
        } else {
          ids.forEach((id) => {
            loadedIds.current.add(id);
            entryTimestamps.current[id] = now;
          });
          setStaleStates((prev) => ({ ...prev, ...incoming }));
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
      const now = Date.now();
      const toFetch = featureIds.filter(
        (id) =>
          !loadedIds.current.has(id) ||
          now - (entryTimestamps.current[id] ?? 0) > ENTRY_TTL_MS,
      );
      await doFetch(toFetch);
    },
    [doFetch],
  );

  const fetchAll = useCallback(() => doFetch(), [doFetch]);

  const invalidate = useCallback((ids: string[]) => {
    ids.forEach((id) => {
      loadedIds.current.delete(id);
      delete entryTimestamps.current[id];
    });
    hasFetchedAll.current = false;
  }, []);

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (delay = ENTRY_TTL_MS) => {
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
        if (!cancelled) schedule(failed ? ERROR_RETRY_MS : ENTRY_TTL_MS);
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [doFetch]);

  const getStaleState = useCallback(
    (featureId: string): StaleStateEntry | undefined => staleStates[featureId],
    [staleStates],
  );

  return createElement(
    StaleStatesContext.Provider,
    {
      value: {
        fetchSome,
        fetchAll,
        invalidate,
        getStaleState,
        loading,
        staleStates,
      },
    },
    children,
  );
}

export function useFeatureStaleStates(): UseFeatureStaleStatesReturn {
  const ctx = useContext(StaleStatesContext);
  if (!ctx) {
    throw new Error(
      "useFeatureStaleStates must be used within FeatureStaleStatesProvider",
    );
  }
  return ctx;
}
