import { DeleteFactTableResponse } from "../../../types/openapi";
import {
  deleteFactTable as deleteFactTableFromDb,
  getFactTable,
} from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { deleteFactTableValidator } from "../../validators/openapi";

export const deleteFactTable = createApiRequestHandler(
  deleteFactTableValidator
)(
  async (req): Promise<DeleteFactTableResponse> => {
    const factTable = await getFactTable(req.organization.id, req.params.id);
    if (!factTable) {
      throw new Error(
        "Unable to delete - Could not find factTable with that id"
      );
    }

    req.checkPermissions("manageFactTables", factTable.projects);

    await deleteFactTableFromDb(factTable, req.eventAudit);

    return {
      deletedId: req.params.id,
    };
  }
);
