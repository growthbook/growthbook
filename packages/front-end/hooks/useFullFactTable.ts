import { FactTableInterface } from "shared/types/fact-table";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";

// The definitions endpoint returns a slimmed fact table (no sql, no per-column
// jsonFields). Components that need the full column metadata fetch it by id.
// While the request is in flight we fall back to the slim definition so the
// column skeleton stays available and jsonFields fill in once it resolves. sql
// is intentionally excluded from the return type so callers can't read a value
// the fallback never has.
export default function useFullFactTable(id: string | null | undefined) {
  const { getFactTableById } = useDefinitions();
  const { data, mutate } = useApi<{ factTable: FactTableInterface }>(
    `/fact-tables/${id}`,
    { shouldRun: () => !!id },
  );
  const factTable: Omit<FactTableInterface, "sql"> | null =
    data?.factTable ?? (id ? getFactTableById(id) : null);
  return { factTable, mutate };
}
