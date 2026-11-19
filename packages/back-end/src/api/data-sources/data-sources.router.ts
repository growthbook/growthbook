import { OpenApiRoute } from "back-end/src/util/handler";
import { getDataSource } from "./getDataSource";
import { getInformationSchema } from "./getInformationSchema";
import { listDataSources } from "./listDataSources";
import { sqlRoutes } from "./sql/sql.router";
import {
  deleteDataSource,
  postDataSource,
  postDataSourceInformationSchemaRefresh,
  updateDataSource,
} from "./manageDataSource";

export const dataSourcesRoutes: OpenApiRoute[] = [
  listDataSources,
  postDataSource,
  getDataSource,
  getInformationSchema,
  updateDataSource,
  deleteDataSource,
  postDataSourceInformationSchemaRefresh,
  ...sqlRoutes,
];
