import {
  ColumnInterface,
  FactTableInterface,
  UpdateColumnProps,
} from "shared/types/fact-table";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { prepareColumnUpdate } from "@/services/columnEditModel";

// Saves an edit to an existing column through the column-edit model
export default function useSaveFactTableColumn(factTable: FactTableInterface) {
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
      await apiCall(`${url}/top-values`, { method: "POST" });
    }
    await mutateDefinitions();
  };
}
