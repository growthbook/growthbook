import { postFactTableColumnValidator } from "shared/validators";
import {
  createColumn,
  getFactTable,
  toFactTableColumnApiInterface,
} from "back-end/src/models/FactTableModel";
import { validateVirtualColumnProps } from "back-end/src/util/factTable";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postFactTableColumn = createApiRequestHandler(
  postFactTableColumnValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.factTableId);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  if (!req.context.permissions.canUpdateFactTable(factTable, { columns: [] })) {
    req.context.permissions.throwPermissionError();
  }

  // The public API can only create virtual (computed) columns; SQL-detected
  // columns come from column auto-detection.
  validateVirtualColumnProps(req.body);

  const column = await createColumn(factTable, {
    ...req.body,
    isVirtual: true,
  });

  return {
    factTableColumn: toFactTableColumnApiInterface(column),
  };
});
