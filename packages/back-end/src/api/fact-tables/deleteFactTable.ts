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
    const factTable = await getFactTable(req.context, req.params.id);
    if (!factTable) {
      throw new Error(
        "Unable to delete - Could not find factTable with that id"
      );
    }

    if (!req.context.permissions.canDeleteFactTable(factTable)) {
      req.context.permissions.throwPermissionError();
    }

    await deleteFactTableFromDb(req.context, factTable);

    return {
      deletedId: req.params.id,
    };
  }
);
