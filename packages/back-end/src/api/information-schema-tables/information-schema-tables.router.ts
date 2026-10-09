import { OpenApiRoute } from "back-end/src/util/handler";
import { getInformationSchemaTable } from "./getInformationSchemaTable";
import { postInformationSchemaTableRefresh } from "./postInformationSchemaTableRefresh";

export const informationSchemaTablesRoutes: OpenApiRoute[] = [
  getInformationSchemaTable,
  postInformationSchemaTableRefresh,
];
