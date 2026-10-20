import { OpenApiRoute } from "back-end/src/util/handler";
import { getDataSource } from "./getDataSource";
import { getInformationSchema } from "./getInformationSchema";
import { listDataSources } from "./listDataSources";
import { sqlRoutes } from "./sql/sql.router";

export const dataSourcesRoutes: OpenApiRoute[] = [
  listDataSources,
  getDataSource,
  getInformationSchema,
  ...sqlRoutes,
];
