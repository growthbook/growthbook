import { previewColumnValuesValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { previewWarehouseColumnValues } from "back-end/src/agent/ask-data-tools";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const previewColumnValues = createApiRequestHandler(
  previewColumnValuesValidator,
)(async (req) => {
  const datasource = await getDataSourceById(req.context, req.params.id);
  if (!datasource) {
    throw new Error("Could not find data source with that id");
  }
  if (!req.context.org.settings?.aiAskDataEnabled) {
    throw new Error("Ask data is not enabled for this organization");
  }
  if (!datasource.settings?.askData?.enabled) {
    throw new Error("Ask data is not enabled for this data source");
  }
  if (!req.context.permissions.canRunSchemaQueries(datasource)) {
    req.context.permissions.throwPermissionError();
  }

  const result = await previewWarehouseColumnValues(req.context, datasource, {
    ...req.body,
    limit: req.body.limit ?? 20,
  });
  return result as {
    table: string;
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  };
});
