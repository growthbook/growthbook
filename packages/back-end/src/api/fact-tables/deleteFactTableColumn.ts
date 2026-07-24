import { deleteFactTableColumnValidator } from "shared/validators";
import { deleteColumn, getFactTable } from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getSourceIntegrationObject,
  getIntegrationIdentifierQuote,
} from "back-end/src/services/datasource";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteFactTableColumn = createApiRequestHandler(
  deleteFactTableColumnValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.factTableId);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  if (!req.context.permissions.canUpdateFactTable(factTable, { columns: [] })) {
    req.context.permissions.throwPermissionError();
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
