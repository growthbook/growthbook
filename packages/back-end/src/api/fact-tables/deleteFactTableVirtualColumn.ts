import { deleteFactTableVirtualColumnValidator } from "shared/validators";
import { deleteColumn, getFactTable } from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getSourceIntegrationObject,
  getIntegrationIdentifierQuote,
} from "back-end/src/services/datasource";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteFactTableVirtualColumn = createApiRequestHandler(
  deleteFactTableVirtualColumnValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.factTableId);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  // Deleting a virtual column removes a stored SQL expression, so it needs the
  // same gate as creating or editing one.
  if (!req.context.permissions.canManageFactTableVirtualColumn(factTable)) {
    req.context.permissions.throwPermissionError();
  }

  const column = factTable.columns.find((c) => c.column === req.params.id);
  if (!column) {
    throw new Error("Could not find a column with that id");
  }

  // Only virtual (computed) columns are deletable through the API; SQL-detected
  // columns are managed by column auto-detection.
  if (!column.isVirtual) {
    throw new Error("Only virtual columns can be deleted");
  }

  // The datasource's identifier-quote style makes the dependency scan
  // (nested virtual columns, filters, explorations, ...) treat quoted
  // identifiers correctly for this dialect.
  const datasource = await getDataSourceById(req.context, factTable.datasource);
  await deleteColumn(
    req.context,
    factTable,
    req.params.id,
    datasource
      ? getIntegrationIdentifierQuote(
          getSourceIntegrationObject(req.context, datasource),
        )
      : '"',
  );

  return {
    deletedId: req.params.id,
  };
});
