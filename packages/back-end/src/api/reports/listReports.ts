import { listReportsValidator } from "shared/validators";
import {
  getReportsByExperimentId,
  getReportsByOrg,
} from "back-end/src/models/ReportModel";
import {
  getAllExperiments,
  getExperimentById,
} from "back-end/src/models/ExperimentModel";
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
    // Post-filter by accessible experiments — getReportsByOrg with an empty
    // project skips its own project gate, which would otherwise leak reports
    // across projects the caller can't read.
    const allReports = await getReportsByOrg(req.context, "");
    const accessibleExperiments = await getAllExperiments(req.context, {
      includeArchived: true,
    });
    const accessibleExperimentIds = new Set(
      accessibleExperiments.map((e) => e.id),
    );
    reports = allReports.filter(
      (r) => !r.experimentId || accessibleExperimentIds.has(r.experimentId),
    );
  }

  const { filtered, returnFields } = applyPagination(reports, req.query);

  return {
    reports: filtered.map((r) => toReportApiInterface(r)),
    ...returnFields,
  };
});
