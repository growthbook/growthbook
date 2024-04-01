import { DeleteFactTableFilterResponse } from "../../../types/openapi";
import { deleteFactFilter, getFactTable } from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { deleteFactTableFilterValidator } from "../../validators/openapi";

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

    // Passing in the factTable twice since deleteFactFilter only supports removing a filter and
    // not changing a FactTable's project(s)
    if (!req.context.permissions.canUpdateFactTable(factTable, factTable)) {
      req.context.permissions.throwPermissionError();
    }
    await deleteFactFilter(req.context, factTable, req.params.id);

    return {
      deletedId: req.params.id,
    };
  }
);
