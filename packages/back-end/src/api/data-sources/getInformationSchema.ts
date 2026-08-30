import { InformationSchemaInterfaceWithPaths } from "shared/types/integrations";
import {
  getInformationSchemaValidator,
  ApiInformationSchema,
} from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getInformationSchemaByDatasourceId } from "back-end/src/models/InformationSchemaModel";
import { getInformationSchemaWithPaths } from "back-end/src/services/informationSchema";
import { createApiRequestHandler } from "back-end/src/util/handler";

function toApiInformationSchema(
  schema: InformationSchemaInterfaceWithPaths,
): ApiInformationSchema {
  return {
    id: schema.id,
    datasourceId: schema.datasourceId,
    status: schema.status,
    error: schema.error ?? undefined,
    databases: schema.databases.map((db) => ({
      databaseName: db.databaseName,
      path: db.path,
      dateCreated: db.dateCreated.toISOString(),
      dateUpdated: db.dateUpdated.toISOString(),
      schemas: db.schemas.map((s) => ({
        schemaName: s.schemaName,
        path: s.path,
        dateCreated: s.dateCreated.toISOString(),
        dateUpdated: s.dateUpdated.toISOString(),
        tables: s.tables.map((t) => ({
          tableName: t.tableName,
          path: t.path,
          id: t.id,
          numOfColumns: t.numOfColumns,
          dateCreated: t.dateCreated.toISOString(),
          dateUpdated: t.dateUpdated.toISOString(),
        })),
      })),
    })),
    dateCreated: schema.dateCreated.toISOString(),
    dateUpdated: schema.dateUpdated.toISOString(),
  };
}

export const getInformationSchema = createApiRequestHandler(
  getInformationSchemaValidator,
)(async (req) => {
  const dataSource = await getDataSourceById(
    req.context,
    req.params.dataSourceId,
  );
  if (!dataSource) {
    throw new Error("Could not find data source with that id");
  }

  const informationSchema = await getInformationSchemaByDatasourceId(
    dataSource.id,
    req.context.org.id,
  );

  if (!informationSchema) {
    throw new Error("No information schema found for this data source");
  }

  const enriched = getInformationSchemaWithPaths(
    informationSchema,
    dataSource.type,
  );

  return {
    informationSchema: toApiInformationSchema(enriched),
  };
});
