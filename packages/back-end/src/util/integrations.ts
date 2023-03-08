import { DataSourceType } from "../../types/datasource";
import {
  InformationSchema,
  RawInformationSchema,
  Schema,
} from "../types/Integration";

type RowType = {
  tableCatalog: string;
  tableSchema?: string;
  tableName?: string;
  columnName?: string;
};

function getPath(dataSource: DataSourceType, path: RowType): string {
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
  const formattedResultsMap = new Map();

  results.forEach((row) => {
    if (!formattedResultsMap.has(row.table_catalog)) {
      formattedResultsMap.set(row.table_catalog, {
        databaseName: row.table_catalog.toLocaleLowerCase(),
        schemas: new Map(),
        path: getPath(datasourceType, {
          tableCatalog: row.table_catalog,
        }),
      });
    }

    const currentSchemaCatalog = formattedResultsMap.get(row.table_catalog);

    if (!currentSchemaCatalog.schemas.has(row.table_schema)) {
      currentSchemaCatalog.schemas.set(row.table_schema, {
        schemaName: row.table_schema.toLocaleLowerCase(),
        tables: new Map(),
        path: getPath(datasourceType, {
          tableCatalog: row.table_catalog,
          tableSchema: row.table_schema,
        }),
      });
    }

    const currentTableSchema = currentSchemaCatalog.schemas.get(
      row.table_schema
    );

    if (!currentTableSchema.tables.has(row.table_name)) {
      currentTableSchema.tables.set(row.table_name, {
        tableName: row.table_name.toLocaleLowerCase(),
      });
    }
  });

  const formattedResultsArr = Array.from(formattedResultsMap.values());

  // Convert everything from maps to arrays.
  formattedResultsArr.forEach((informationSchema: InformationSchema) => {
    informationSchema.schemas = Array.from(informationSchema.schemas.values());
    informationSchema.schemas.forEach((schema: Schema) => {
      schema.tables = Array.from(schema.tables.values());
    });
  });

  return formattedResultsArr;
}
