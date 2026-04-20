import { OpenApiRoute } from "back-end/src/util/handler";
import { listReports } from "./listReports";
import { getReport } from "./getReport";
import { postReport } from "./postReport";
import { postReportRefresh } from "./postReportRefresh";

export const reportRoutes: OpenApiRoute[] = [
  listReports,
  getReport,
  postReport,
  postReportRefresh,
];
