import { OpenApiRoute } from "back-end/src/util/handler";
import { refreshInterleaving } from "./refresh";
import { cancelInterleavingRefresh } from "./cancelRefresh";
import { getInterleavingResults } from "./getResults";

export const interleavingsRoutes: OpenApiRoute[] = [
  refreshInterleaving,
  cancelInterleavingRefresh,
  getInterleavingResults,
];
