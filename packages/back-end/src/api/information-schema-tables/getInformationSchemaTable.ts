import { getInformationSchemaTableValidator } from "shared/validators";
import { InformationSchemaTablesInterface } from "shared/types/integrations";
import { getInformationSchemaTableById } from "back-end/src/models/InformationSchemaTablesModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

export const getInformationSchemaTable = createApiRequestHandler(
  getInformationSchemaTableValidator,
)(async (req) => {
  const table = await getInformationSchemaTableById(
    req.context.org.id,
    req.params.tableId,
  );

  if (!table) {
    throw new Error("Could not find information schema table with that id");
  }

  const datasource = await getDataSourceById(req.context, table.datasourceId);

  if (!datasource) {
    throw new Error("Could not find information schema table with that id");
  }

  return {
    informationSchemaTable: toInformationSchemaTableApiInterface(table),
  };
});

export function toInformationSchemaTableApiInterface(
  table: InformationSchemaTablesInterface,
) {
  return {
    id: table.id,
    datasourceId: table.datasourceId,
    informationSchemaId: table.informationSchemaId,
    tableName: table.tableName,
    tableSchema: table.tableSchema,
    databaseName: table.databaseName,
    columns: table.columns,
    refreshMS: table.refreshMS,
    dateCreated: table.dateCreated.toISOString(),
    dateUpdated: table.dateUpdated.toISOString(),
  };
}
