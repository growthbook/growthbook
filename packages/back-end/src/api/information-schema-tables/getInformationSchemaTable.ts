import { GetInformationSchemaTableResponse } from "shared/types/openapi";
import { getInformationSchemaTableValidator } from "shared/validators";
import { getInformationSchemaTableById } from "back-end/src/models/InformationSchemaTablesModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getInformationSchemaTable = createApiRequestHandler(
  getInformationSchemaTableValidator,
)(async (req): Promise<GetInformationSchemaTableResponse> => {
  const table = await getInformationSchemaTableById(
    req.context.org.id,
    req.params.tableId,
  );

  if (!table) {
    throw new Error("Could not find information schema table with that id");
  }

  return {
    informationSchemaTable: {
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
    },
  };
});
