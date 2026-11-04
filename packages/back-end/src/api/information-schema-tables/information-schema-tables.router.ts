import type { OpenApiRoute } from "back-end/src/util/handler";
import { getInformationSchemaTable } from "./getInformationSchemaTable";

export const informationSchemaTablesRoutes: OpenApiRoute[] = [
  getInformationSchemaTable,
];
