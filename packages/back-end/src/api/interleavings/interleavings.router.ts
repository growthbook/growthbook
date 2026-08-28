import { OpenApiRoute } from "back-end/src/util/handler";
import { refreshInterleaving } from "./refresh";
import { cancelInterleavingRefresh } from "./cancelRefresh";
import { getInterleavingResults } from "./getResults";
import { startInterleaving } from "./start";
import { stopInterleaving } from "./stop";
import { linkInterleavingFeature } from "./linkFeature";

export const interleavingsRoutes: OpenApiRoute[] = [
  refreshInterleaving,
  cancelInterleavingRefresh,
  getInterleavingResults,
  startInterleaving,
  stopInterleaving,
  linkInterleavingFeature,
];
