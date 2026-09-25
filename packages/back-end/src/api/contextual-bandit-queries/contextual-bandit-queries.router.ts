import type { contextualBanditQueryEndpoints } from "shared/api-endpoints";
import { OpenApiRoute } from "back-end/src/util/handler";
import { getContextualBanditQuery } from "./getContextualBanditQuery";
import { createContextualBanditQuery } from "./createContextualBanditQuery";
import { listContextualBanditQueries } from "./listContextualBanditQueries";
import { deleteContextualBanditQuery } from "./deleteContextualBanditQuery";
import { updateContextualBanditQuery } from "./updateContextualBanditQuery";

// One entry per export of contextualBanditQueryEndpoints: a missing handler or
// a leftover one for a deleted endpoint fails type-checking.
const routes = {
  getContextualBanditQuery,
  createContextualBanditQuery,
  listContextualBanditQueries,
  deleteContextualBanditQuery,
  updateContextualBanditQuery,
} satisfies Record<keyof typeof contextualBanditQueryEndpoints, OpenApiRoute>;

export const contextualBanditQueriesRoutes: OpenApiRoute[] =
  Object.values(routes);
