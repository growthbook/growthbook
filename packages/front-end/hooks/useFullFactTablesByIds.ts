import { useCallback, useRef, useState } from "react";
import { FactTableInterface } from "shared/types/fact-table";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

const ENTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes per entry

// Full fact tables (real jsonFields) for a specific, small set of ids — the
// org-wide definitions payload (useDefinitions().getFactTableById) strips
// jsonFields to keep that payload light. Scoped to a single consumer
// (ExplorerContext's dimension picker), so this is a plain hook rather than
// a shared context provider — each call site gets its own cache.
export default function useFullFactTablesByIds() {
  const { apiCall } = useAuth();
  const { getFactTableById: getSlimFactTableById } = useDefinitions();
  // `null` marks an id the fetch resolved but the endpoint didn't return
  // (deleted, or no longer permission-accessible) — distinct from "not
  // fetched yet" — so `isFullyLoaded` can tell the two apart.
  const [factTables, setFactTables] = useState<
    Record<string, FactTableInterface | null>
  >({});
  const entryTimestamps = useRef<Record<string, number>>({});
  const inflightKey = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSome = useCallback(
    async (ids: string[]) => {
      const now = Date.now();
      const toFetch = [
        ...new Set(
          ids.filter(
            (id) =>
              !entryTimestamps.current[id] ||
              now - entryTimestamps.current[id] > ENTRY_TTL_MS,
          ),
        ),
      ];
      if (!toFetch.length) return;

      const key = toFetch.sort().join(",");
      if (inflightKey.current === key) return;
      inflightKey.current = key;

      setLoading(true);
      try {
        const res = await apiCall<{ factTables: FactTableInterface[] }>(
          `/fact-tables/full?ids=${toFetch.map(encodeURIComponent).join(",")}`,
        );
        const fetchedAt = Date.now();
        setFactTables((prev) => {
          const next = { ...prev };
          const foundIds = new Set(res.factTables.map((ft) => ft.id));
          res.factTables.forEach((ft) => {
            next[ft.id] = ft;
          });
          toFetch.forEach((id) => {
            if (!foundIds.has(id)) next[id] = null;
          });
          return next;
        });
        toFetch.forEach((id) => {
          entryTimestamps.current[id] = fetchedAt;
        });
      } finally {
        setLoading(false);
        inflightKey.current = null;
      }
    },
    [apiCall],
  );

  const getFullFactTableById = useCallback(
    (id: string): Omit<FactTableInterface, "sql"> | null =>
      factTables[id] ?? getSlimFactTableById(id),
    [factTables, getSlimFactTableById],
  );

  // Whether full (jsonFields-complete) data has been fetched for every id in
  // the list — as opposed to `loading`, which only reflects an in-flight
  // request. Callers use this to tell "not loaded yet" apart from "genuinely
  // no valid columns", since `getFullFactTableById` falls back to slim data
  // (silently missing jsonFields) until the fetch resolves.
  const isFullyLoaded = useCallback(
    (ids: string[]) => ids.every((id) => id in factTables),
    [factTables],
  );

  return { fetchSome, getFullFactTableById, isFullyLoaded, loading };
}
