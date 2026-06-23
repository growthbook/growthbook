import { useCallback, useEffect, useRef, useState } from "react";
import { ActiveDraftStatus } from "shared/validators";
import { useAuth } from "@/services/auth";

export type DraftStatusCounts = Partial<Record<ActiveDraftStatus, number>>;
type DraftStateCache = Record<string, DraftStatusCounts>;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30_000;

export interface UseEntityDraftStatesReturn {
  draftStates: DraftStateCache;
  fetchSome: (ids: string[]) => Promise<void>;
  fetchAll: () => Promise<void>;
  loading: boolean;
  mutate: () => Promise<void>;
}

// Generic "active draft status counts per entity id" hook. Backs the list-page
// "Draft Status" column for any revision-backed entity (saved groups, constants).
// `path` is the draft-states endpoint; `responseKey` is the field on the JSON
// response that holds the id→counts map.
export function useEntityDraftStates({
  path,
  responseKey,
}: {
  path: string;
  responseKey: string;
}): UseEntityDraftStatesReturn {
  const { apiCall } = useAuth();
  const [draftStates, setDraftStates] = useState<DraftStateCache>({});
  const cachedIds = useRef(new Set<string>());
  const hasFetchedAll = useRef(false);
  const [loading, setLoading] = useState(false);
  const inflightKey = useRef<string | null>(null);

  // Returns true on success (or a no-op skip), false on a fetch failure, so the
  // periodic refresh can back off to a shorter retry interval. Never throws —
  // callers fire this from effects without awaiting, so a transient failure
  // (e.g. an aborted fetch on navigation) must not surface as an unhandled
  // rejection; draft-status dots are a best-effort enhancement.
  const doFetch = useCallback(
    async (ids?: string[]): Promise<boolean> => {
      if (ids !== undefined && !ids.length) return true;
      const key = ids === undefined ? "__all__" : [...ids].sort().join(",");
      if (inflightKey.current === key) return true;
      inflightKey.current = key;
      const url = ids !== undefined ? `${path}?ids=${ids.join(",")}` : path;
      setLoading(true);
      try {
        const res = await apiCall<Record<string, DraftStateCache>>(url);
        const incoming = res[responseKey] ?? {};
        if (ids === undefined) {
          hasFetchedAll.current = true;
          Object.keys(incoming).forEach((id) => cachedIds.current.add(id));
          setDraftStates(incoming);
        } else {
          ids.forEach((id) => cachedIds.current.add(id));
          setDraftStates((prev) => ({ ...prev, ...incoming }));
        }
        return true;
      } catch {
        return false;
      } finally {
        setLoading(false);
        inflightKey.current = null;
      }
    },
    [apiCall, path, responseKey],
  );

  const fetchSome = useCallback(
    async (ids: string[]) => {
      if (hasFetchedAll.current) return;
      const uncached = ids.filter((id) => !cachedIds.current.has(id));
      await doFetch(uncached);
    },
    [doFetch],
  );

  const fetchAll = useCallback(async () => {
    await doFetch();
  }, [doFetch]);

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (delay = REFRESH_INTERVAL_MS) => {
      id = setTimeout(async () => {
        if (cancelled) return;
        let failed = false;
        if (cachedIds.current.size) {
          const ok = hasFetchedAll.current
            ? await doFetch()
            : await doFetch([...cachedIds.current]);
          failed = !ok;
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
