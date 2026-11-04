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
import { FeatureHealthStateEntry } from "shared/util";
import { useAuth } from "@/services/auth";

export type { FeatureHealthStateEntry };
export type FeatureHealthStateMap = Record<string, FeatureHealthStateEntry>;

const ENTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes per entry
const ERROR_RETRY_MS = 30_000;
// Ids per background refresh request, so a long session never builds a URL
// the server's header limit rejects.
const REFRESH_CHUNK = 100;

export interface UseFeatureHealthStatesReturn {
  // After a fetchAll, only IDs missing from that snapshot are fetched.
  fetchSome: (featureIds: string[]) => Promise<void>;
  // Fetches all org features and keeps them fresh until releaseAll.
  fetchAll: () => Promise<void>;
  // The caller no longer needs every feature: background refreshes go back
  // to the features on screen.
  releaseAll: () => void;
  // Keeps these features refreshed while a view shows them; call the returned
  // function when it stops.
  watch: (featureIds: string[]) => () => void;
  // Removes specific IDs from the cache so the next fetchSome re-fetches them.
  invalidate: (ids: string[]) => void;
  getHealthState: (featureId: string) => FeatureHealthStateEntry | undefined;
  loading: boolean;
  healthStates: FeatureHealthStateMap;
}

const HealthStatesContext = createContext<UseFeatureHealthStatesReturn | null>(
  null,
);

export function FeatureHealthStatesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const [healthStates, setHealthStates] = useState<FeatureHealthStateMap>({});
  const loadedIds = useRef(new Set<string>());
  const entryTimestamps = useRef<Record<string, number>>({});
  const hasFetchedAll = useRef(false);
  const keepAllFresh = useRef(false);
  // How many mounted views show each id; background refreshes cover these
  // rather than everything seen this session.
  const watched = useRef(new Map<string, number>());
  const [loading, setLoading] = useState(false);
  const inflightKey = useRef<string | null>(null);
  // Orders requests against invalidations, so a response that was already in
  // flight when an id was invalidated cannot overwrite the fresh result.
  const clock = useRef(0);
  const invalidatedAt = useRef(new Map<string, number>());

  // Resolves to whether the request succeeded; a failed window is retried by
  // the next refresh.
  const doFetch = useCallback(
    async (ids?: string[]): Promise<boolean> => {
      if (ids !== undefined && !ids.length) return true;
      const key = ids === undefined ? "__all__" : [...ids].sort().join(",");
      if (inflightKey.current === key) return true;
      inflightKey.current = key;
      const url =
        ids !== undefined
          ? `/features/health?ids=${encodeURIComponent(ids.join(","))}`
          : "/features/health";
      const startedAt = ++clock.current;
      setLoading(true);
      try {
        const res = await apiCall<{ features: FeatureHealthStateMap }>(url);
        const isCurrent = (id: string) =>
          (invalidatedAt.current.get(id) ?? 0) < startedAt;
        const incoming = Object.fromEntries(
          Object.entries(res.features ?? {}).filter(([id]) => isCurrent(id)),
        );
        const now = Date.now();
        if (ids === undefined) hasFetchedAll.current = true;
        (ids ?? Object.keys(incoming)).filter(isCurrent).forEach((id) => {
          loadedIds.current.add(id);
          entryTimestamps.current[id] = now;
        });
        setHealthStates((prev) => ({ ...prev, ...incoming }));
        return true;
      } catch {
        return false;
      } finally {
        setLoading(false);
        if (inflightKey.current === key) inflightKey.current = null;
      }
    },
    [apiCall],
  );

  const fetchSome = useCallback(
    async (featureIds: string[]) => {
      const now = Date.now();
      const toFetch = featureIds.filter(
        (id) =>
          !loadedIds.current.has(id) ||
          (!hasFetchedAll.current &&
            now - (entryTimestamps.current[id] ?? 0) > ENTRY_TTL_MS),
      );
      await doFetch(toFetch);
    },
    [doFetch],
  );

  const fetchAll = useCallback(async () => {
    keepAllFresh.current = true;
    await doFetch();
  }, [doFetch]);

  const releaseAll = useCallback(() => {
    keepAllFresh.current = false;
  }, []);

  const watch = useCallback((ids: string[]) => {
    ids.forEach((id) =>
      watched.current.set(id, (watched.current.get(id) ?? 0) + 1),
    );
    return () =>
      ids.forEach((id) => {
        const count = (watched.current.get(id) ?? 1) - 1;
        if (count > 0) watched.current.set(id, count);
        else watched.current.delete(id);
      });
  }, []);

  const invalidate = useCallback((ids: string[]) => {
    const at = ++clock.current;
    ids.forEach((id) => {
      loadedIds.current.delete(id);
      delete entryTimestamps.current[id];
      invalidatedAt.current.set(id, at);
    });
    hasFetchedAll.current = false;
    // A forced refetch must not be deduplicated against a request in flight.
    inflightKey.current = null;
  }, []);

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (delay = ENTRY_TTL_MS) => {
      id = setTimeout(async () => {
        if (cancelled) return;
        let failed = false;
        if (keepAllFresh.current) {
          failed = !(await doFetch());
        } else {
          const ids = [...watched.current.keys()];
          for (let i = 0; i < ids.length; i += REFRESH_CHUNK) {
            if (cancelled) return;
            if (!(await doFetch(ids.slice(i, i + REFRESH_CHUNK)))) {
              failed = true;
            }
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

  const getHealthState = useCallback(
    (featureId: string): FeatureHealthStateEntry | undefined =>
      healthStates[featureId],
    [healthStates],
  );

  return createElement(
    HealthStatesContext.Provider,
    {
      value: {
        fetchSome,
        fetchAll,
        releaseAll,
        watch,
        invalidate,
        getHealthState,
        loading,
        healthStates,
      },
    },
    children,
  );
}

export function useFeatureHealthStates(): UseFeatureHealthStatesReturn {
  const ctx = useContext(HealthStatesContext);
  if (!ctx) {
    throw new Error(
      "useFeatureHealthStates must be used within FeatureHealthStatesProvider",
    );
  }
  return ctx;
}
