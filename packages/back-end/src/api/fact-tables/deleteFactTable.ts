import { DeleteFactTableResponse } from "back-end/types/openapi";
import {
  deleteFactTable as deleteFactTableFromDb,
  getFactTable,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteFactTableValidator } from "back-end/src/validators/openapi";

export const deleteFactTable = createApiRequestHandler(
  deleteFactTableValidator,
)(async (req): Promise<DeleteFactTableResponse> => {
  const factTable = await getFactTable(req.context, req.params.id);
  if (!factTable) {
    throw new Error("Unable to delete - Could not find factTable with that id");
  }

  await deleteFactTableFromDb(req.context, factTable);

  return {
    deletedId: req.params.id,
  };
});
