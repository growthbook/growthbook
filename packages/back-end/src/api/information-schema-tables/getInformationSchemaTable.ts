import { getInformationSchemaTableValidator } from "shared/validators";
import { InformationSchemaTablesInterface } from "shared/types/integrations";
import { getInformationSchemaTableById } from "back-end/src/models/InformationSchemaTablesModel";
import { getInformationSchemaByTableId } from "back-end/src/models/InformationSchemaModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { createInformationSchemaTableFromWarehouse } from "back-end/src/services/informationSchema";
import { NotFoundError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

export const getInformationSchemaTable = createApiRequestHandler(
  getInformationSchemaTableValidator,
)(async (req) => {
  const { table } = await getOrCreateInformationSchemaTable(
    req.context,
    req.params.tableId,
  );
  return {
    informationSchemaTable: toInformationSchemaTableApiInterface(table),
  };
});

/**
 * The cached table, or, like the app, one read from the warehouse the first
 * time a table listed in the information schema is asked for.
 */
export async function getOrCreateInformationSchemaTable(
  context: ApiReqContext,
  tableId: string,
) {
  const notFound = new NotFoundError(
    "Could not find information schema table with that id",
  );
  const table = await getInformationSchemaTableById(context.org.id, tableId);
  if (table) {
    const datasource = await getDataSourceById(context, table.datasourceId);
    if (!datasource) throw notFound;
    return { table, datasource, created: false };
  }

  const informationSchema = await getInformationSchemaByTableId(
    context.org.id,
    tableId,
  );
  const datasource =
    informationSchema &&
    (await getDataSourceById(context, informationSchema.datasourceId));
  if (!informationSchema || !datasource) throw notFound;
  const created = await createInformationSchemaTableFromWarehouse(
    context as ReqContext,
    datasource,
    informationSchema,
    tableId,
  );
  return { table: created, datasource, created: true };
}

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
