import { listReportsValidator } from "shared/validators";
import {
  getReportsByExperimentId,
  getReportsByOrg,
} from "back-end/src/models/ReportModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  createApiRequestHandler,
  applyPagination,
} from "back-end/src/util/handler";
import { toReportApiInterface } from "./toReportApiInterface";

export const listReports = createApiRequestHandler(listReportsValidator)(async (
  req,
) => {
  const { org } = req.context;

  let reports;
  if (req.query.experimentId) {
    // Gate by experiment read permission so an org-scoped key can't enumerate
    // reports for experiments in projects the caller can't access.
    const experiment = await getExperimentById(
      req.context,
      req.query.experimentId,
    );
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }
    reports = await getReportsByExperimentId(org.id, req.query.experimentId);
  } else {
    reports = await getReportsByOrg(req.context, "");
  }

  const { filtered, returnFields } = applyPagination(reports, req.query);

  return {
    reports: filtered.map((r) => toReportApiInterface(r)),
    ...returnFields,
  };
});
