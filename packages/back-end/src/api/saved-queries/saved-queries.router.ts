import { OpenApiRoute } from "back-end/src/util/handler";
import {
  deleteSavedQuery,
  getSavedQueryHandler,
  listSavedQueries,
  postSavedQuery,
  postSavedQueryRefresh,
  updateSavedQuery,
} from "./savedQueries";

export const savedQueriesRoutes: OpenApiRoute[] = [
  listSavedQueries,
  postSavedQuery,
  getSavedQueryHandler,
  updateSavedQuery,
  deleteSavedQuery,
  postSavedQueryRefresh,
];
