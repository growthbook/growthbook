import uniqid from "uniqid";
import {
  InformationSchema,
  RawInformationSchema,
  Schema,
  Table,
} from "shared/types/integrations";

export function formatInformationSchema(
  results: RawInformationSchema[],
): InformationSchema[] {
  const databases = new Map<string, InformationSchema>();
  const schemas = new Map<string, Schema>();
  const tables = new Map<string, Table>();

  const date = new Date();

  results.forEach((row) => {
    // Use database name as key since paths are deprecated
    const dbKey = row.table_catalog;
    let database = databases.get(dbKey);
    if (!database) {
      database = {
        databaseName: row.table_catalog,
        schemas: [],
        dateCreated: date,
        dateUpdated: date,
      };
      databases.set(dbKey, database);
    }

    // Use schema name as key since paths are deprecated
    const schemaKey = `${row.table_catalog}.${row.table_schema}`;
    let schema = schemas.get(schemaKey);
    if (!schema) {
      schema = {
        schemaName: row.table_schema,
        tables: [],
        dateCreated: date,
        dateUpdated: date,
      };
      schemas.set(schemaKey, schema);
      database.schemas.push(schema);
    }

    const tableKey = `${row.table_catalog}.${row.table_schema}.${row.table_name}`;
    let table = tables.get(tableKey);
    if (!table) {
      table = {
        tableName: row.table_name,
        numOfColumns: parseInt(row.column_count, 10),
        id: uniqid("tbl_"),
        dateCreated: date,
        dateUpdated: date,
      };
      tables.set(tableKey, table);
      const schemaIndex = database.schemas.findIndex(
        (schema) => schema.schemaName === row.table_schema,
      );
      database.schemas[schemaIndex].tables.push(table);
    }
  });
  return Array.from(databases.values());
}
