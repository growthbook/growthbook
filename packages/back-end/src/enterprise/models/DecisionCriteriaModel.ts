import {
  DecisionCriteriaInterface,
  decisionCriteriaInterface,
  DEFAULT_DC_HEALTH_SIGNALS,
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
  globallyUniquePrimaryKeys: false,
});

// TODO: project scoping or make more permissive
export class DecisionCriteriaModel extends BaseClass {
  protected migrate(legacyDoc: unknown): DecisionCriteriaInterface {
    if (legacyDoc && typeof legacyDoc === "object") {
      const raw = legacyDoc as Record<string, unknown>;
      delete raw["rampBehavior"];
      if (!raw["healthSignals"]) {
        raw["healthSignals"] = { ...DEFAULT_DC_HEALTH_SIGNALS };
      }
    }
    return legacyDoc as DecisionCriteriaInterface;
  }

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
