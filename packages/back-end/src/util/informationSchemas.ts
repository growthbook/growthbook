import uniqid from "uniqid";
import { DataSourceType } from "@back-end/types/datasource";
import {
  InformationSchema,
  RawInformationSchema,
  Schema,
  Table,
} from "@back-end/src/types/Integration";

type RowType = {
  tableCatalog: string;
  tableSchema?: string;
  tableName?: string;
  columnName?: string;
};

export function getPath(dataSourceType: DataSourceType, path: RowType): string {
  const pathArray = Object.values(path);
  const returnValue = pathArray.join(".");
  switch (dataSourceType) {
    // MySQL only supports path's that go two levels deep. E.G. If the full path is database.schema.table.column, it only supports table.column.
    case "mysql":
      if (pathArray.length === 1) {
        return "";
      } else {
        return pathArray.slice(1, pathArray.length).join(".");
      }

    case "bigquery":
      return "`" + returnValue + "`"; // BigQuery requires backticks around the path
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
    const dbPath = getPath(datasourceType, {
      tableCatalog: row.table_catalog,
    });
    let database = databases.get(dbPath);
    if (!database) {
      database = {
        databaseName: row.table_catalog,
        schemas: [],
        path: dbPath,
        dateCreated: date,
        dateUpdated: date,
      };
      databases.set(dbPath, database);
    }

    const schemaPath = getPath(datasourceType, {
      tableCatalog: row.table_catalog,
      tableSchema: row.table_schema,
    });
    let schema = schemas.get(schemaPath);
    if (!schema) {
      schema = {
        schemaName: row.table_schema,
        tables: [],
        path: schemaPath,
        dateCreated: date,
        dateUpdated: date,
      };
      schemas.set(schemaPath, schema);
      database.schemas.push(schema);
    }

    // Do the same for tables
    const tablePath = getPath(datasourceType, {
      tableCatalog: row.table_catalog,
      tableSchema: row.table_schema,
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
