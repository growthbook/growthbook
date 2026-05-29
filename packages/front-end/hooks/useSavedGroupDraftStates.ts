import { useCallback, useEffect, useRef, useState } from "react";
import { ActiveDraftStatus } from "shared/validators";
import { useAuth } from "@/services/auth";

export type DraftStatusCounts = Partial<Record<ActiveDraftStatus, number>>;
type DraftStateCache = Record<string, DraftStatusCounts>;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30_000;

export interface UseSavedGroupDraftStatesReturn {
  draftStates: DraftStateCache;
  fetchSome: (groupIds: string[]) => Promise<void>;
  fetchAll: () => Promise<void>;
  loading: boolean;
  mutate: () => Promise<void>;
}

export function useSavedGroupDraftStates(): UseSavedGroupDraftStatesReturn {
  const { apiCall } = useAuth();
  const [draftStates, setDraftStates] = useState<DraftStateCache>({});
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
          ? `/saved-groups/draft-states?ids=${ids.join(",")}`
          : "/saved-groups/draft-states";
      setLoading(true);
      try {
        const res = await apiCall<{ groups: DraftStateCache }>(url);
        const incoming = res.groups ?? {};
        if (ids === undefined) {
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => cachedIds.current.add(id));
          setDraftStates(incoming);
        } else {
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
    async (groupIds: string[]) => {
      if (hasFetchedAll.current) return;
      const uncached = groupIds.filter((id) => !cachedIds.current.has(id));
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

  return { draftStates, fetchSome, fetchAll, loading, mutate: fetchAll };
}
