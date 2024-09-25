import { DeleteFactTableFilterResponse } from "back-end/types/openapi";
import {
  deleteFactFilter,
  getFactTable,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteFactTableFilterValidator } from "back-end/src/validators/openapi";

export const deleteFactTableFilter = createApiRequestHandler(
  deleteFactTableFilterValidator
)(
  async (req): Promise<DeleteFactTableFilterResponse> => {
    const factTable = await getFactTable(req.context, req.params.factTableId);
    if (!factTable) {
      throw new Error(
        "Unable to delete - Could not find factTable with that id"
      );
    }

    if (!req.context.permissions.canDeleteFactFilter(factTable)) {
      req.context.permissions.throwPermissionError();
    }
    await deleteFactFilter(req.context, factTable, req.params.id);

    return {
      deletedId: req.params.id,
    };
  }
);
