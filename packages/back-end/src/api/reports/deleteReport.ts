import { deleteReportValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  deleteReportById,
  getReportById,
} from "back-end/src/models/ReportModel";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteReport = createApiRequestHandler(deleteReportValidator)(
  async (req) => {
    const { context } = req;
    const report = await getReportById(context.org.id, req.params.id);
    if (!report) throw new NotFoundError("Could not find report");

    // Same rules as the app: someone else's report needs the admin permission
    if (
      (!report.userId || report.userId !== context.userId) &&
      !context.permissions.canSuperDeleteReport()
    ) {
      context.permissions.throwPermissionError();
    }
    const experiment = await getExperimentById(
      context,
      report.experimentId || "",
    );
    if (!context.permissions.canDeleteReport(experiment || {})) {
      context.permissions.throwPermissionError();
    }

    await deleteReportById(context.org.id, report.id);
    return { deletedId: report.id };
  },
);
