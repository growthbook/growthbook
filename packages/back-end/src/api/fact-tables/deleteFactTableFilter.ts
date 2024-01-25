import { DeleteFactTableFilterResponse } from "../../../types/openapi";
import { deleteFactFilter, getFactTable } from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { deleteFactTableFilterValidator } from "../../validators/openapi";

export const deleteFactTableFilter = createApiRequestHandler(
  deleteFactTableFilterValidator
)(
  async (req): Promise<DeleteFactTableFilterResponse> => {
    const factTable = await getFactTable(
      req.organization.id,
      req.params.factTableId
    );
    if (!factTable) {
      throw new Error(
        "Unable to delete - Could not find factTable with that id"
      );
    }
    req.checkPermissions("manageFactTables", factTable.projects);

    await deleteFactFilter(factTable, req.params.id);

    return {
      deletedId: req.params.id,
    };
  }
);
