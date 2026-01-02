import {
  DecisionCriteriaInterface,
  decisionCriteriaInterface,
} from "shared/enterprise";
import { MakeModelClass } from "back-end/src/models/BaseModel";

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
  protected async beforeDelete(existing: DecisionCriteriaInterface) {
    const defaultDecisionCriteriaId =
      this.context.org.settings?.defaultDecisionCriteriaId;
    if (existing.id === defaultDecisionCriteriaId) {
      throw new Error("Cannot delete organization default decision criteria");
    }
  }
  protected canDelete(): boolean {
    return this.context.permissions.canDeleteDecisionCriteria();
  }
}
