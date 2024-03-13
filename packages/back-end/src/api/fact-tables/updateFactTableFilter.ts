import { updateFactTableFilterValidator } from "@/src/validators/openapi";
import { UpdateFactTableFilterResponse } from "@/types/openapi";
import {
  updateFactFilter,
  toFactTableFilterApiInterface,
  getFactTable,
} from "@/src/models/FactTableModel";
import { createApiRequestHandler } from "@/src/util/handler";

export const updateFactTableFilter = createApiRequestHandler(
  updateFactTableFilterValidator
)(
  async (req): Promise<UpdateFactTableFilterResponse> => {
    const factTable = await getFactTable(req.context, req.params.factTableId);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }
    req.checkPermissions("manageFactTables", factTable.projects);

    if (req.body.managedBy === "api" && !factTable.managedBy) {
      throw new Error(
        "Cannot set filter to be managed by api unless Fact Table is also managed by api"
      );
    }

    await updateFactFilter(req.context, factTable, req.params.id, req.body);

    const newFilters = [...factTable.filters];
    const filterIndex = newFilters.findIndex((f) => f.id === req.params.id);
    newFilters[filterIndex] = { ...newFilters[filterIndex], ...req.body };

    return {
      factTableFilter: toFactTableFilterApiInterface(
        { ...factTable, filters: newFilters },
        req.params.id
      ),
    };
  }
);
