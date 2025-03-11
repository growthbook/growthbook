import { MakeModelClass } from "back-end/src/models/BaseModel";
import {
  DecisionCriteriaInterface,
  decisionCriteriaInterface,
} from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";

const BaseClass = MakeModelClass({
  schema: decisionCriteriaInterface,
  collectionName: "decisioncriteria",
  idPrefix: "deccrit__",
  auditLog: {
    entity: "decisionCriteria",
    createEvent: "decisionCriteria.create",
    updateEvent: "decisionCriteria.update",
    deleteEvent: "decisionCriteria.delete",
  },
  globallyUniqueIds: false,
});

export class DecisionCriteriaModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: DecisionCriteriaInterface): boolean {
    // TODO permissions
    return this.context.permissions.canCreateExperimentTemplate(doc);
  }
  protected canRead(doc: DecisionCriteriaInterface): boolean {
    return this.context.hasPermission("readData", doc.project || "");
  }
  protected canUpdate(
    existing: DecisionCriteriaInterface,
    updates: DecisionCriteriaInterface
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      updates
    );
  }
  protected canDelete(doc: DecisionCriteriaInterface): boolean {
    return this.context.permissions.canDeleteExperimentTemplate(doc);
  }
}
