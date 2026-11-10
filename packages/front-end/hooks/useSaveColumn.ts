import {
  ColumnInterface,
  FactTableInterface,
  UpdateColumnProps,
} from "shared/types/fact-table";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { prepareColumnUpdate } from "@/services/factTables";

// Saves an edit to an existing column with the shared save policy
export default function useSaveColumn(factTable: FactTableInterface) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

  return async (column: ColumnInterface, changes: UpdateColumnProps) => {
    const { data, loadTopValues } = prepareColumnUpdate(
      factTable,
      column,
      changes,
    );
    const url = `/fact-tables/${factTable.id}/column/${encodeURIComponent(column.column)}`;
    await apiCall(url, { method: "PUT", body: JSON.stringify(data) });
    if (loadTopValues) {
      // The endpoint skips identifier columns unless told this is an Auto Slice
      await apiCall(`${url}/top-values?forceAutoSlice=true`, {
        method: "POST",
      });
    }
    await mutateDefinitions();
  };
}
