import { deleteFactTableValidator } from "@/src/validators/openapi";
import { DeleteFactTableResponse } from "@/types/openapi";
import {
  deleteFactTable as deleteFactTableFromDb,
  getFactTable,
} from "@/src/models/FactTableModel";
import { createApiRequestHandler } from "@/src/util/handler";

export const deleteFactTable = createApiRequestHandler(
  deleteFactTableValidator
)(
  async (req): Promise<DeleteFactTableResponse> => {
    const factTable = await getFactTable(req.context, req.params.id);
    if (!factTable) {
      throw new Error(
        "Unable to delete - Could not find factTable with that id"
      );
    }

    req.checkPermissions("manageFactTables", factTable.projects);

    await deleteFactTableFromDb(req.context, factTable);

    return {
      deletedId: req.params.id,
    };
  }
);
