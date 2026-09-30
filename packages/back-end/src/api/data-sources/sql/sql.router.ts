import type { OpenApiRoute } from "back-end/src/util/handler";
import { searchTables } from "./searchTables";
import { getTableSchema } from "./getTableSchema";
import { previewColumnValues } from "./previewColumnValues";
import { runSqlQuery } from "./runSqlQuery";

export const sqlRoutes: OpenApiRoute[] = [
  searchTables,
  getTableSchema,
  previewColumnValues,
  runSqlQuery,
];
