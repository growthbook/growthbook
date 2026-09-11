import { OpenApiRoute } from "back-end/src/util/handler";
import { getDataSource } from "./getDataSource";
import { getInformationSchema } from "./getInformationSchema";
import { listDataSources } from "./listDataSources";

const listDataSourcesV2 = {
  ...listDataSources,
  version: "v2" as const,
  operationId: "listDataSourcesV2",
};
const getDataSourceV2 = {
  ...getDataSource,
  version: "v2" as const,
  operationId: "getDataSourceV2",
};

export const dataSourcesRoutes: OpenApiRoute[] = [
  listDataSources,
  getDataSource,
  getInformationSchema,
  listDataSourcesV2,
  getDataSourceV2,
];
