import { OpenApiRoute } from "back-end/src/util/handler";
import { refreshInterleaving } from "./refresh";
import { getInterleavingResults } from "./getResults";

export const interleavingsRoutes: OpenApiRoute[] = [
  refreshInterleaving,
  getInterleavingResults,
];
