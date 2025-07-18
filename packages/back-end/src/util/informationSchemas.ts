import uniqid from "uniqid";
import {
  InformationSchema,
  RawInformationSchema,
  Schema,
  Table,
} from "back-end/src/types/Integration";
import { DataSourceType } from "back-end/types/datasource";

export function getPath(
  dataSourceType: DataSourceType,
  params: {
    catalog: string;
    schema: string;
    tableName: string;
  }
): string {
  const { catalog, schema, tableName } = params;
  const pathArray = [catalog, schema, tableName];
  const returnValue = pathArray.join(".");

  switch (dataSourceType) {
    // MySQL and ClickHouse both support paths that go two levels deep
    // Backticks help avoid issues with reserved words or special characters
    case "mysql":
    case "clickhouse":
      return [schema, tableName]
        .map((part) => "`" + part + "`") // Wrap each path part in backticks for safety
        .join(".");

    case "bigquery":
      return "`" + returnValue + "`"; // BigQuery requires backticks around the full path
    case "growthbook_clickhouse":
      return tableName; // Only return the table name

    default:
      return returnValue;
  }
}

export function formatInformationSchema(
  results: RawInformationSchema[],
  datasourceType: DataSourceType
): InformationSchema[] {
  const databases = new Map<string, InformationSchema>();
  const schemas = new Map<string, Schema>();
  const tables = new Map<string, Table>();

  const date = new Date();

  results.forEach((row) => {
    // Use database name as key since paths are deprecated
    const databaseName = row.table_catalog;
    let database = databases.get(databaseName);
    if (!database) {
      database = {
        databaseName: row.table_catalog,
        schemas: [],
        dateCreated: date,
        dateUpdated: date,
      };
      databases.set(databaseName, database);
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

    const tablePath = getPath(datasourceType, {
      catalog: row.table_catalog,
      schema: row.table_schema,
      tableName: row.table_name,
    });
    let table = tables.get(tablePath);
    if (!table) {
      table = {
        tableName: row.table_name,
        path: tablePath,
        numOfColumns: parseInt(row.column_count, 10),
        id: uniqid("tbl_"),
        dateCreated: date,
        dateUpdated: date,
      };
      tables.set(tablePath, table);
      const schemaIndex = database.schemas.findIndex(
        (schema) => schema.schemaName === row.table_schema
      );
      database.schemas[schemaIndex].tables.push(table);
    }
  });
  return Array.from(databases.values());
}
