import { OpenApiRoute } from "back-end/src/util/handler";
import { listErrorTrackingSourceMaps } from "./listSourceMaps";
import { postErrorTrackingSourceMap } from "./postSourceMap";

export const errorTrackingRoutes: OpenApiRoute[] = [
  postErrorTrackingSourceMap,
  listErrorTrackingSourceMaps,
];
