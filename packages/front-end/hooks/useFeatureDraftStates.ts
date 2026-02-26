import { useCallback, useEffect, useRef, useState } from "react";
import { ActiveDraftStatus } from "shared/validators";
import { useAuth } from "@/services/auth";

export type DraftStateEntry = { status: ActiveDraftStatus; version: number };
type DraftStateCache = Record<string, DraftStateEntry>;

// Matches usePrerequisiteStates refresh cadence.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface UseFeatureDraftStatesReturn {
  // featureId → highest-priority active draft entry; absent if no active draft.
  draftStates: DraftStateCache;
  // Skips already-cached IDs; no-op if fetchAll has already run.
  fetchSome: (featureIds: string[]) => Promise<void>;
  // Fetches all org features, overwriting the cache.
  fetchAll: () => Promise<void>;
  loading: boolean;
  mutate: () => Promise<void>;
}

export function useFeatureDraftStates(): UseFeatureDraftStatesReturn {
  const { apiCall } = useAuth();
  const [draftStates, setDraftStates] = useState<DraftStateCache>({});
  const cachedIds = useRef(new Set<string>());
  const hasFetchedAll = useRef(false);
  const [loading, setLoading] = useState(false);
  // Prevents concurrent duplicate fetches (e.g. React Strict Mode double-invocation).
  const inflightKey = useRef<string | null>(null);

  // Internal: always hits the API regardless of cache state.
  // ids = undefined → fetch all; ids = [] → no-op.
  const doFetch = useCallback(
    async (ids?: string[]) => {
      if (ids !== undefined && !ids.length) return;
      const key = ids === undefined ? "__all__" : [...ids].sort().join(",");
      if (inflightKey.current === key) return;
      inflightKey.current = key;
      const url =
        ids !== undefined
          ? `/features/draft-states?ids=${ids.join(",")}`
          : "/features/draft-states";
      setLoading(true);
      try {
        const res = await apiCall<{ features: DraftStateCache }>(url);
        const incoming = res.features ?? {};
        if (ids === undefined) {
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => cachedIds.current.add(id));
          setDraftStates(incoming);
        } else {
          // Mark ALL requested IDs as cached, not just ones that returned data.
          // Features absent from the response simply have no active draft.
          ids.forEach((id) => cachedIds.current.add(id));
          setDraftStates((prev) => ({ ...prev, ...incoming }));
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
      const uncached = featureIds.filter((id) => !cachedIds.current.has(id));
      await doFetch(uncached);
    },
    [doFetch],
  );

  const fetchAll = useCallback(() => doFetch(), [doFetch]);

  // Periodically refresh whatever has already been loaded.
  // Recursive setTimeout so slow requests don't stack.
  // cancelled flag prevents rescheduling after unmount, even if a fetch was in-flight.
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = () => {
      id = setTimeout(async () => {
        if (cancelled) return;
        if (cachedIds.current.size) {
          await (hasFetchedAll.current
            ? doFetch()
            : doFetch([...cachedIds.current]));
        }
        if (!cancelled) schedule();
      }, REFRESH_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [doFetch]);

  return { draftStates, fetchSome, fetchAll, loading, mutate: fetchAll };
}
