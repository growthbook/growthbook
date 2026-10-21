import { OpenApiRoute } from "back-end/src/util/handler";
import { getEvent, listAudits, listEvents } from "./audits";

export const auditsRoutes: OpenApiRoute[] = [listAudits, listEvents, getEvent];
