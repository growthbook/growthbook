import { useCallback, useMemo } from "react";
import { FullFactTableColumns } from "shared/types/fact-table";
import useApi from "@/hooks/useApi";

// Full fact tables (real jsonFields) for a small id set. The org-wide
// definitions payload strips jsonFields, so the picker/validator cannot
// use getFactTableById from useDefinitions() for nested JSON columns.
export default function useFullFactTables(ids: string[]) {
  const unique = useMemo(() => [...new Set(ids.filter(Boolean))].sort(), [ids]);
  const requestedIds = useMemo(() => new Set(unique), [unique]);

  const { data } = useApi<{ factTables: FullFactTableColumns[] }>(
    `/fact-tables/full?ids=${unique.map(encodeURIComponent).join(",")}`,
    { shouldRun: () => unique.length > 0 },
  );

  const byId = useMemo(() => {
    const map = new Map<string, FullFactTableColumns>();
    data?.factTables.forEach((ft) => map.set(ft.id, ft));
    return map;
  }, [data]);

  const currentResolved = unique.length === 0 || data !== undefined;

  const getById = useCallback(
    (id: string): FullFactTableColumns | null => byId.get(id) ?? null,
    [byId],
  );

  const isLoadedFor = useCallback(
    (checkIds: string[]) => {
      const needed = [...new Set(checkIds.filter(Boolean))];
      if (!needed.length) return true;
      return needed.every(
        (id) => byId.has(id) || (currentResolved && requestedIds.has(id)),
      );
    },
    [byId, currentResolved, requestedIds],
  );

  return {
    getById,
    isLoaded: currentResolved,
    isLoadedFor,
  };
}
