import { DataSourceType } from "../../types/datasource";
import {
  InformationSchema,
  RawInformationSchema,
  Schema,
  Table,
} from "../types/Integration";

type RowType = {
  tableCatalog: string;
  tableSchema?: string;
  tableName?: string;
  columnName?: string;
};

export function getPath(dataSource: DataSourceType, path: RowType): string {
  const pathArray = Object.values(path);
  const returnValue = pathArray.join(".").toLocaleLowerCase();
  switch (dataSource) {
    // MySQL only supports path's that go two levels deep. E.G. If the full path is database.schema.table.column, it only supports table.column.
    case "mysql":
      if (pathArray.length === 1) {
        return "";
      } else {
        return pathArray
          .slice(1, pathArray.length)
          .join(".")
          .toLocaleLowerCase();
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

  results.forEach((row) => {
    const dbPath = getPath(datasourceType, {
      tableCatalog: row.table_catalog,
    });
    let database = databases.get(dbPath);
    if (!database) {
      database = {
        databaseName: row.table_catalog.toLocaleLowerCase(),
        schemas: [],
        path: dbPath,
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
        schemaName: row.table_schema.toLocaleLowerCase(),
        tables: [],
        path: schemaPath,
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
        tableName: row.table_name.toLocaleLowerCase(),
        path: tablePath,
        numOfColumns: parseInt(row.column_count, 10),
        id: "",
      };
      tables.set(tablePath, table);
      const schemaIndex = database.schemas.findIndex(
        (schema) => schema.schemaName === row.table_schema.toLocaleLowerCase()
      );
      database.schemas[schemaIndex].tables.push(table);
    }
  });
  return Array.from(databases.values());
}
