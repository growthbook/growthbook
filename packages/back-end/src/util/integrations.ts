import { InformationSchema, RawInformationSchema } from "../types/Integration";

export function formatInformationSchema(
  results: RawInformationSchema[],
  datasourceType: string
): InformationSchema[] {
  const formattedResults: InformationSchema[] = [];

  const isMySQL = datasourceType === "mysql";

  results.forEach((row) => {
    const key = row.table_catalog;

    if (
      !formattedResults.length ||
      formattedResults.findIndex((i) => i.database_name === key) === -1
    ) {
      formattedResults.push({
        database_name: key,
        schemas: [],
        path: key,
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
        path: `${key}.${row.table_schema}`,
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
        path: isMySQL
          ? `${row.table_schema}.${row.table_name}`
          : `${key}.${row.table_schema}.${row.table_name}`,
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
      path: isMySQL
        ? `${row.table_name}.${row.column_name}`
        : `${key}.${row.table_schema}.${row.table_name}.${row.column_name}`,
    });
  });

  return formattedResults;
}
