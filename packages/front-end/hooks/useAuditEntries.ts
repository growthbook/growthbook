import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuditInterface,
  AuditUserApiKey,
  AuditUserLoggedIn,
  AuditUserSystem,
} from "shared/types/audit";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAuth } from "@/services/auth";
import {
  AuditDiffConfig,
  AuditUserInfo,
  CoarsenedAuditEntry,
  GroupByOption,
} from "@/components/Audit/types";

const PAGE_LIMIT = 50;
const LOAD_ALL_CAP = 200;

interface RawAuditEntry<T> {
  id: string;
  event: string;
  dateCreated: Date;
  user: AuditInterface["user"];
  preSnapshot: T | null;
  postSnapshot: T | null;
}

function getAuthorKey(user: AuditInterface["user"]): string {
  if ("system" in user && (user as AuditUserSystem).system) return "system";
  if ("apiKey" in user) return `apikey:${(user as AuditUserApiKey).apiKey}`;
  return `user:${(user as AuditUserLoggedIn).id}`;
}

function toAuditUserInfo(user: AuditInterface["user"]): AuditUserInfo {
  if ("system" in user && (user as AuditUserSystem).system) {
    return { type: "system" };
  }
  if ("apiKey" in user) {
    return { type: "apikey", apiKey: (user as AuditUserApiKey).apiKey };
  }
  const u = user as AuditUserLoggedIn;
  return { type: "user", id: u.id, email: u.email, name: u.name };
}

function getTimeBucketKey(date: Date, groupBy: GroupByOption): string {
  const d = new Date(date);
  if (groupBy === "day") {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  if (groupBy === "hour") {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
  }
  // minute (default)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

function coarsenEntries<T>(
  entries: RawAuditEntry<T>[],
  groupBy: GroupByOption,
): CoarsenedAuditEntry<T>[] {
  if (!entries.length) return [];

  const result: CoarsenedAuditEntry<T>[] = [];

  // Process oldest-first for proper pre/post chaining; we'll reverse for display
  const sorted = [...entries].sort(
    (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime(),
  );

  let current: CoarsenedAuditEntry<T> | null = null;
  let currentAuthorKey = "";
  let currentBucketKey = "";

  for (const entry of sorted) {
    if (!entry.postSnapshot) continue; // skip unparseable entries

    const authorKey = getAuthorKey(entry.user);
    const bucketKey = getTimeBucketKey(entry.dateCreated, groupBy);
    const groupKey = `${bucketKey}||${authorKey}`;
    const prevGroupKey = `${currentBucketKey}||${currentAuthorKey}`;

    if (current && groupKey === prevGroupKey) {
      // Merge into current group — update post to latest, extend date range
      current.postSnapshot = entry.postSnapshot;
      current.dateEnd = entry.dateCreated;
      current.event = entry.event;
      current.rawIds.push(entry.id);
      current.count += 1;
    } else {
      if (current) result.push(current);
      current = {
        id: entry.id,
        rawIds: [entry.id],
        event: entry.event,
        dateStart: entry.dateCreated,
        dateEnd: entry.dateCreated,
        user: toAuditUserInfo(entry.user),
        preSnapshot: entry.preSnapshot,
        postSnapshot: entry.postSnapshot,
        count: 1,
      };
      currentAuthorKey = authorKey;
      currentBucketKey = bucketKey;
    }
  }
  if (current) result.push(current);

  // Newest-first for display (like CompareRevisionsModal)
  return result.reverse();
}

function splitCoarsenedEntry<T>(
  entry: CoarsenedAuditEntry<T>,
  allRaw: RawAuditEntry<T>[],
): CoarsenedAuditEntry<T>[] {
  const raw = allRaw
    .filter((r) => entry.rawIds.includes(r.id))
    .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime());

  return raw
    .map((r, i) => {
      if (!r.postSnapshot) return null;
      return {
        id: r.id,
        rawIds: [r.id],
        event: r.event,
        dateStart: r.dateCreated,
        dateEnd: r.dateCreated,
        user: toAuditUserInfo(r.user),
        preSnapshot:
          i === 0 ? entry.preSnapshot : (raw[i - 1].postSnapshot ?? null),
        postSnapshot: r.postSnapshot,
        count: 1,
      } as CoarsenedAuditEntry<T>;
    })
    .filter((e): e is CoarsenedAuditEntry<T> => e !== null)
    .reverse();
}

function parseDetails<T>(
  details: string | undefined,
  event: string,
): { pre: T | null; post: T | null } {
  if (!details) return { pre: null, post: null };
  try {
    const parsed = JSON.parse(details) as {
      pre?: T;
      post?: T;
    };
    // Create events only have `post`
    const isCreate = event.endsWith(".create");
    return {
      pre: isCreate ? null : (parsed.pre ?? null),
      post: parsed.post ?? null,
    };
  } catch {
    return { pre: null, post: null };
  }
}

interface FetchPageResult<T> {
  parsed: RawAuditEntry<T>[];
  total: number;
  nextCursor: string | null;
}

interface UseAuditEntriesResult<T> {
  /** Coarsened entries sorted newest-first, ready for the left column. */
  entries: CoarsenedAuditEntry<T>[];
  loading: boolean;
  loadingAll: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  /** Whether "All changes" quick action is safe to offer (total <= cap). */
  canLoadAll: boolean;
  loadMore: () => void;
  loadAll: () => Promise<void>;
  /**
   * Expand a single coarsened entry back into its constituent raw entries.
   * Returns the replacement rows in newest-first order.
   */
  expandEntry: (entry: CoarsenedAuditEntry<T>) => CoarsenedAuditEntry<T>[];
  groupBy: GroupByOption;
  setGroupBy: (g: GroupByOption) => void;
}

export function useAuditEntries<T>(
  config: AuditDiffConfig<T>,
  entityId: string,
): UseAuditEntriesResult<T> {
  const { apiCall } = useAuth();

  const [groupBy, setGroupBy] = useLocalStorage<GroupByOption>(
    `audit:compare-events:${config.entityType}:groupBy`,
    config.defaultGroupBy ?? "minute",
  );
  const [rawEntries, setRawEntries] = useState<RawAuditEntry<T>[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchPage = useCallback(
    async (cursorParam: string | null): Promise<FetchPageResult<T>> => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cursorParam) params.set("cursor", cursorParam);

      const res = await apiCall<{
        status: number;
        events: (AuditInterface & { dateCreated: string })[];
        total: number;
        nextCursor: string | null;
      }>(`/history/${config.entityType}/${entityId}?${params.toString()}`);

      const filtered = (res.events ?? []).filter((e) =>
        config.includedEvents.includes(e.event),
      );

      const parsed: RawAuditEntry<T>[] = filtered.map((e) => {
        const { pre, post } = parseDetails<T>(e.details, e.event);
        return {
          id: e.id,
          event: e.event,
          dateCreated: new Date(e.dateCreated),
          user: e.user,
          preSnapshot: pre,
          postSnapshot: post,
        };
      });

      return { parsed, total: res.total, nextCursor: res.nextCursor };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiCall, config.entityType, entityId],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRawEntries([]);
    setCursor(null);
    setHasMore(false);
    setTotal(0);

    (async () => {
      try {
        const result = await fetchPage(null);
        if (cancelled || !isMounted.current) return;
        setRawEntries(result.parsed);
        setTotal(result.total);
        setCursor(result.nextCursor);
        setHasMore(!!result.nextCursor);
      } catch (e) {
        if (!cancelled && isMounted.current)
          setError("Failed to load history.");
      } finally {
        if (!cancelled && isMounted.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, config.entityType]);

  const loadMore = useCallback(() => {
    if (!cursor || loading) return;
    setLoading(true);
    (async () => {
      try {
        const result = await fetchPage(cursor);
        if (!isMounted.current) return;
        setRawEntries((prev) => [...prev, ...result.parsed]);
        setCursor(result.nextCursor);
        setHasMore(!!result.nextCursor);
      } catch {
        if (isMounted.current) setError("Failed to load more history.");
      } finally {
        if (isMounted.current) setLoading(false);
      }
    })();
  }, [cursor, loading, fetchPage]);

  const loadAll = useCallback(async () => {
    if (!hasMore || loadingAll) return;
    setLoadingAll(true);
    try {
      let nextCursor = cursor;
      const accumulated: RawAuditEntry<T>[] = [];
      while (nextCursor) {
        const result = await fetchPage(nextCursor);
        if (!isMounted.current) return;
        accumulated.push(...result.parsed);
        nextCursor = result.nextCursor;
      }
      if (!isMounted.current) return;
      setRawEntries((prev) => [...prev, ...accumulated]);
      setCursor(null);
      setHasMore(false);
    } catch {
      if (isMounted.current) setError("Failed to load all history.");
    } finally {
      if (isMounted.current) setLoadingAll(false);
    }
  }, [cursor, hasMore, loadingAll, fetchPage]);

  const expandEntry = useCallback(
    (entry: CoarsenedAuditEntry<T>): CoarsenedAuditEntry<T>[] => {
      if (entry.count <= 1) return [entry];
      return splitCoarsenedEntry(entry, rawEntries);
    },
    [rawEntries],
  );

  const entries = coarsenEntries(rawEntries, groupBy);

  return {
    entries,
    loading,
    loadingAll,
    error,
    hasMore,
    total,
    canLoadAll: total <= LOAD_ALL_CAP,
    loadMore,
    loadAll,
    expandEntry,
    groupBy,
    setGroupBy,
  };
}
