import { DataSourceType } from "../../types/datasource";
import { InformationSchema, RawInformationSchema } from "../types/Integration";

type RowType = {
  table_catalog: string;
  table_schema?: string;
  table_name?: string;
  column_name?: string;
};

function getPath(dataSource: DataSourceType, path: RowType): string {
  const pathArray = Object.values(path);
  let returnValue = pathArray.join(".");
  switch (dataSource) {
    // MySQL only supports path's that go two levels deep. E.G. If the full path is database.schema.table.column, it only supports table.column.
    case "mysql":
      if (pathArray.length > 2) {
        returnValue = pathArray.slice(-2).join(".");
      }
      return returnValue;
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
  const formattedResultsMap = new Map();

  results.forEach((row) => {
    if (!formattedResultsMap.has(row.table_catalog)) {
      formattedResultsMap.set(row.table_catalog, {
        database_name: row.table_catalog,
        schemas: new Map(),
        path: getPath(datasourceType, {
          table_catalog: row.table_catalog,
        }),
      });
    }

    const currentSchemaCatalog = formattedResultsMap.get(row.table_catalog);

    if (!currentSchemaCatalog.schemas.has(row.table_schema)) {
      currentSchemaCatalog.schemas.set(row.table_schema, {
        schema_name: row.table_schema,
        tables: new Map(),
        path: getPath(datasourceType, {
          table_catalog: row.table_catalog,
          table_schema: row.table_schema,
        }),
      });
    }

    const currentTableSchema = currentSchemaCatalog.schemas.get(
      row.table_schema
    );

    if (!currentTableSchema.tables.has(row.table_name)) {
      currentTableSchema.tables.set(row.table_name, {
        table_name: row.table_name,
        columns: new Map(),
        path: getPath(datasourceType, {
          table_catalog: row.table_catalog,
          table_schema: row.table_schema,
          table_name: row.table_name,
        }),
      });
    }

    const currentColumnsSchema = currentTableSchema.tables.get(row.table_name);

    if (!currentColumnsSchema.columns.has(row.column_name)) {
      currentColumnsSchema.columns.set(row.column_name, {
        column_name: row.column_name,
        data_type: row.data_type,
        path: getPath(datasourceType, {
          table_catalog: row.table_catalog,
          table_schema: row.table_schema,
          table_name: row.table_name,
          column_name: row.column_name,
        }),
      });
    }
  });

  const formattedResultsArr = Array.from(formattedResultsMap.values());

  // Convert everything from maps to arrays.
  formattedResultsArr.forEach((schema) => {
    schema.schemas = Array.from(schema.schemas.values());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema.schemas.forEach((table: any) => {
      table.tables = Array.from(table.tables.values());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      table.tables.forEach((column: any) => {
        column.columns = Array.from(column.columns.values());
      });
    });
  });

  return formattedResultsArr;
}
