import { updateFactTableColumnValidator } from "shared/validators";
import {
  getFactTable,
  toFactTableColumnApiInterface,
  updateColumn,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const updateFactTableColumn = createApiRequestHandler(
  updateFactTableColumnValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.factTableId);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  if (!req.context.permissions.canUpdateFactTable(factTable, { columns: [] })) {
    req.context.permissions.throwPermissionError();
  }

  const column = factTable.columns.find((c) => c.column === req.params.id);
  if (!column) {
    throw new Error("Could not find a column with that id");
  }

  // Only virtual (computed) columns are editable through the API; SQL-detected
  // columns are managed by column auto-detection.
  if (!column.isVirtual) {
    throw new Error("Only virtual columns can be updated");
  }

  // Editing a virtual column's expression must not blank it out.
  if (req.body.sql !== undefined && !req.body.sql.trim()) {
    throw new Error("Virtual columns require a SQL expression");
  }

  await updateColumn({
    context: req.context,
    factTable,
    column: req.params.id,
    changes: req.body,
  });

  const updated = factTable.columns.find((c) => c.column === req.params.id);
  if (!updated) {
    throw new Error("Could not find a column with that id");
  }

  return {
    factTableColumn: toFactTableColumnApiInterface(updated),
  };
});
