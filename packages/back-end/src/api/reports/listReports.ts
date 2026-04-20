import { listReportsValidator } from "shared/validators";
import {
  getReportsByExperimentId,
  getReportsByOrg,
} from "back-end/src/models/ReportModel";
import {
  createApiRequestHandler,
  applyPagination,
} from "back-end/src/util/handler";
import { toReportApiInterface } from "./toReportApiInterface";

export const listReports = createApiRequestHandler(listReportsValidator)(async (
  req,
) => {
  const { org } = req.context;

  const reports = req.query.experimentId
    ? await getReportsByExperimentId(org.id, req.query.experimentId)
    : await getReportsByOrg(req.context, "");

  const { filtered, returnFields } = applyPagination(reports, req.query);

  return {
    reports: filtered.map((r) => toReportApiInterface(r)),
    ...returnFields,
  };
});
