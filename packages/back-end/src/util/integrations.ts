import { DataSourceType } from "../../types/datasource";
import { InformationSchema, RawInformationSchema } from "../types/Integration";

type RowType = {
  key: string;
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
  const formattedResults: InformationSchema[] = [];

  results.forEach((row) => {
    const key = row.table_catalog;

    if (
      !formattedResults.length ||
      formattedResults.findIndex((i) => i.database_name === key) === -1
    ) {
      formattedResults.push({
        database_name: key,
        schemas: [],
        path: getPath(datasourceType, {
          key,
        }),
      });
    }

    const index = formattedResults.findIndex((i) => i.database_name === key);

    if (
      !formattedResults[index].schemas.some(
        (schema) => schema.schema_name === row.table_schema
      )
    ) {
      formattedResults[index].schemas.push({
        schema_name: row.table_schema,
        tables: [],
        path: getPath(datasourceType, {
          key,
          table_schema: row.table_schema,
        }),
      });
    }

    const schemaIndex = formattedResults[index].schemas.findIndex(
      (i) => i.schema_name === row.table_schema
    );

    if (
      !formattedResults[index].schemas[schemaIndex].tables.some(
        (table) => table.table_name === row.table_name
      )
    ) {
      formattedResults[index].schemas[schemaIndex].tables.push({
        table_name: row.table_name,
        columns: [],
        path: getPath(datasourceType, {
          key,
          table_schema: row.table_schema,
          table_name: row.table_name,
        }),
      });
    }

    const tableIndex = formattedResults[index].schemas[
      schemaIndex
    ].tables.findIndex((i) => i.table_name === row.table_name);

    formattedResults[index].schemas[schemaIndex].tables[
      tableIndex
    ].columns?.push({
      column_name: row.column_name,
      data_type: row.data_type,
      path: getPath(datasourceType, {
        key,
        table_schema: row.table_schema,
        table_name: row.table_name,
        column_name: row.column_name,
      }),
    });
  });

  return formattedResults;
}
