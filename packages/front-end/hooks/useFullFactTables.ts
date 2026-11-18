import { useCallback, useMemo } from "react";
import { FullFactTableColumns } from "shared/types/fact-table";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";

// Full fact tables (real jsonFields) for a small id set. The org-wide
// definitions payload strips jsonFields, so the picker/validator cannot
// rely on getFactTableById from useDefinitions() for nested JSON columns.
// Like useFullFactTable, getById falls back to the slim definition until the
// full table arrives, so callers always have at least the top-level columns.
export default function useFullFactTables(ids: string[]) {
  const { getFactTableById } = useDefinitions();
  const unique = [...new Set(ids.filter(Boolean))].sort();
  const { data } = useApi<{ factTables: FullFactTableColumns[] }>(
    `/fact-tables?ids=${unique.map(encodeURIComponent).join(",")}`,
    { shouldRun: () => unique.length > 0 },
  );

  const byId = useMemo(() => {
    const map = new Map<string, FullFactTableColumns>();
    data?.factTables.forEach((ft) => map.set(ft.id, ft));
    return map;
  }, [data]);

  const getById = useCallback(
    (id: string): FullFactTableColumns | null =>
      byId.get(id) ?? getFactTableById(id),
    [byId, getFactTableById],
  );

  // True only when every id has its full table. An id the server omitted
  // (deleted, or no read permission) stays false: we can't validate against
  // it, which is different from validating against nothing.
  const isLoadedFor = useCallback(
    (checkIds: string[]) => checkIds.every((id) => !id || byId.has(id)),
    [byId],
  );

  return { getById, isLoadedFor };
}
