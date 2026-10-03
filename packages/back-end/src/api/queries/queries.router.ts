import { OpenApiRoute } from "back-end/src/util/handler";
import { getQuery } from "./getQuery";
import { listDataSourceQueries, postQueryCancel } from "./queryActions";

export const queriesRoutes: OpenApiRoute[] = [
  getQuery,
  listDataSourceQueries,
  postQueryCancel,
];
