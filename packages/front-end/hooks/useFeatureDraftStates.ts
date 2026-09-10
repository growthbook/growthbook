import { useCallback, useEffect, useRef, useState } from "react";
import { ActiveDraftStatus } from "shared/validators";
import { useAuth } from "@/services/auth";

export type DraftStatusCounts = Partial<Record<ActiveDraftStatus, number>>;
type DraftStateCache = Record<string, DraftStatusCounts>;

// Matches usePrerequisiteStates refresh cadence.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30_000;

export interface UseFeatureDraftStatesReturn {
  // featureId → status counts; absent if no active draft. Empty until
  // fetchAll runs (only the `is:draft` / `has:draft` filters need it).
  draftStates: DraftStateCache;
  fetchAll: () => Promise<void>;
  loading: boolean;
  mutate: () => Promise<void>;
}

export function useFeatureDraftStates(): UseFeatureDraftStatesReturn {
  const { apiCall } = useAuth();
  const [draftStates, setDraftStates] = useState<DraftStateCache>({});
  const hasFetched = useRef(false);
  const [loading, setLoading] = useState(false);
  // Prevents concurrent duplicate fetches (e.g. React Strict Mode double-invocation).
  const inflight = useRef(false);

  const fetchAll = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const res = await apiCall<{ features: DraftStateCache }>(
        "/features/draft-states",
      );
      hasFetched.current = true;
      setDraftStates(res.features ?? {});
    } finally {
      setLoading(false);
      inflight.current = false;
    }
  }, [apiCall]);

  // Periodically refresh once loaded. Recursive setTimeout so slow requests
  // don't stack; the cancelled flag prevents rescheduling after unmount.
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (delay = REFRESH_INTERVAL_MS) => {
      id = setTimeout(async () => {
        if (cancelled) return;
        let failed = false;
        if (hasFetched.current) {
          try {
            await fetchAll();
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
  }, [fetchAll]);

  return { draftStates, fetchAll, loading, mutate: fetchAll };
}
