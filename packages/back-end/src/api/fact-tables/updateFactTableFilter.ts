import { UpdateFactTableFilterResponse } from "../../../types/openapi";
import {
  updateFactFilter,
  toFactTableFilterApiInterface,
  getFactTable,
} from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactTableFilterValidator } from "../../validators/openapi";

export const updateFactTableFilter = createApiRequestHandler(
  updateFactTableFilterValidator
)(
  async (req): Promise<UpdateFactTableFilterResponse> => {
    const factTable = await getFactTable(
      req.organization.id,
      req.params.factTableId
    );
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }
    req.checkPermissions("manageFactTables", factTable.projects);

    await updateFactFilter(factTable, req.params.id, req.body);

    const newFilters = [...factTable.filters];
    const filterIndex = newFilters.findIndex((f) => f.id === req.params.id);
    newFilters[filterIndex] = { ...newFilters[filterIndex], ...req.body };

    return {
      factTable: toFactTableFilterApiInterface(
        { ...factTable, filters: newFilters },
        req.params.id
      ),
    };
  }
);
