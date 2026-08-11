import { OpenApiRoute } from "back-end/src/util/handler";
import { listErrorTrackingSourceMaps } from "./listSourceMaps";
import { postErrorTrackingSourceMap } from "./postSourceMap";
import { listErrorTrackingIssues } from "./listErrorTrackingIssues";
import { getErrorTrackingIssue } from "./getErrorTrackingIssue";
import { listErrorTrackingIssueEvents } from "./listErrorTrackingIssueEvents";
import { getErrorTrackingEvent } from "./getErrorTrackingEvent";

export const errorTrackingRoutes: OpenApiRoute[] = [
  postErrorTrackingSourceMap,
  listErrorTrackingSourceMaps,
  listErrorTrackingIssues,
  getErrorTrackingIssue,
  listErrorTrackingIssueEvents,
  getErrorTrackingEvent,
];
