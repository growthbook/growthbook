import { MakeModelClass } from "./BaseModel";
import { AnalysisPlanInterface, analysisPlanInterface } from "back-end/src/enterprise/routers/analysis-plan/analysis-plan.validators";

const BaseClass = MakeModelClass({
  schema: analysisPlanInterface,
  collectionName: "analysisplan",
  idPrefix: "anplan__",
  auditLog: {
    entity: "analysisPlan",
    createEvent: "analysisPlan.create",
    updateEvent: "analysisPlan.update",
    deleteEvent: "analysisPlan.delete",
  },
  globallyUniqueIds: false,
});

export class AnalysisPlanModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: AnalysisPlanInterface): boolean {
    // TODO permissions
    return this.context.permissions.canCreateExperimentTemplate(doc);
  }
  protected canRead(doc: AnalysisPlanInterface): boolean {
    return this.context.hasPermission("readData", doc.project || "");
  }
  protected canUpdate(
    existing: AnalysisPlanInterface,
    updates: AnalysisPlanInterface
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      updates
    );
  }
  protected canDelete(doc: AnalysisPlanInterface): boolean {
    return this.context.permissions.canDeleteExperimentTemplate(doc);
  }

  // TODO: Implement this for OpenAPI
}
