import { z } from "zod";
import { execReportValidator } from "back-end/src/routers/exec-report/exec-report.validators";
import { MakeModelClass } from "./BaseModel";

// Define the date range type

export type ExecReportInterface = z.infer<typeof execReportValidator>;

const BaseClass = MakeModelClass({
  schema: execReportValidator,
  collectionName: "execreports",
  idPrefix: "exr_",
  auditLog: {
    entity: "execReport",
    createEvent: "execReport.create",
    updateEvent: "execReport.update",
    deleteEvent: "execReport.delete",
  },
  globallyUniqueIds: false,
});

export class ExecReportModel extends BaseClass {
  protected canCreate(doc: ExecReportInterface): boolean {
    return this.context.permissions.canManageExecReports(doc);
  }
  protected canRead(doc: ExecReportInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canUpdate(doc: ExecReportInterface): boolean {
    return this.context.permissions.canManageExecReports(doc);
  }
  protected canDelete(doc: ExecReportInterface): boolean {
    return this.context.permissions.canManageExecReports(doc);
  }

  // Add any specific methods for ExecReports here
}

//export const execReports = new ExecReportModel();
