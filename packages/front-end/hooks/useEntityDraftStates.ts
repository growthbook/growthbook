import { useCallback, useEffect, useRef, useState } from "react";
import { ActiveDraftStatus } from "shared/validators";
import { useAuth } from "@/services/auth";

export type DraftStatusCounts = Partial<Record<ActiveDraftStatus, number>>;
type DraftStateCache = Record<string, DraftStatusCounts>;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30_000;

export interface UseEntityDraftStatesReturn {
  // entity id → status counts; absent if no active draft. Empty until
  // fetchAll runs (only the `has:draft` filter needs it).
  draftStates: DraftStateCache;
  fetchAll: () => Promise<void>;
  loading: boolean;
  mutate: () => Promise<void>;
}

// Generic "active draft status counts per entity id" hook. Backs the list-page
// `has:draft` filter for any revision-backed entity (saved groups, constants,
// configs), so it only ever loads the whole org on demand. `path` is the
// draft-states endpoint; `responseKey` is the field on the JSON response that
// holds the id→counts map.
export function useEntityDraftStates({
  path,
  responseKey,
}: {
  path: string;
  responseKey: string;
}): UseEntityDraftStatesReturn {
  const { apiCall } = useAuth();
  const [draftStates, setDraftStates] = useState<DraftStateCache>({});
  const hasFetched = useRef(false);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);

  // Never throws — callers fire this from effects without awaiting, so a
  // transient failure (e.g. an aborted fetch on navigation) must not surface
  // as an unhandled rejection. Returns false on failure so the periodic
  // refresh can back off.
  const doFetch = useCallback(async (): Promise<boolean> => {
    if (inflight.current) return true;
    inflight.current = true;
    setLoading(true);
    try {
      const res = await apiCall<Record<string, DraftStateCache>>(path);
      hasFetched.current = true;
      setDraftStates(res[responseKey] ?? {});
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
      inflight.current = false;
    }
  }, [apiCall, path, responseKey]);

  const fetchAll = useCallback(async () => {
    await doFetch();
  }, [doFetch]);

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (delay = REFRESH_INTERVAL_MS) => {
      id = setTimeout(async () => {
        if (cancelled) return;
        const failed = hasFetched.current ? !(await doFetch()) : false;
        if (!cancelled) schedule(failed ? ERROR_RETRY_MS : REFRESH_INTERVAL_MS);
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [doFetch]);

  return { draftStates, fetchAll, loading, mutate: fetchAll };
}
