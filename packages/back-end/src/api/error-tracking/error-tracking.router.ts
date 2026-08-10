import { OpenApiRoute } from "back-end/src/util/handler";
import { listErrorTrackingSourceMaps } from "./listSourceMaps";
import { postErrorTrackingSourceMap } from "./postSourceMap";
import { listErrorTrackingIssues } from "./listErrorTrackingIssues";
import { getErrorTrackingIssue } from "./getErrorTrackingIssue";

export const errorTrackingRoutes: OpenApiRoute[] = [
  postErrorTrackingSourceMap,
  listErrorTrackingSourceMaps,
  listErrorTrackingIssues,
  getErrorTrackingIssue,
];
