import { MakeModelClass } from "back-end/src/models/BaseModel";
import { decisionCriteriaInterface } from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";

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

// TODO: project scoping or make more permissive
export class DecisionCriteriaModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(): boolean {
    return this.context.permissions.canCreateDecisionCriteria();
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canUpdateDecisionCriteria();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canDeleteDecisionCriteria();
  }
}
