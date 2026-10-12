import {
  ExperimentQualityConfigInterface,
  experimentQualityConfigValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: experimentQualityConfigValidator,
  collectionName: "experimentqualityconfigs",
  affectsDefinitionsVersion: true,
  idPrefix: "eqc__",
  auditLog: {
    entity: "experimentQualityConfig",
    createEvent: "experimentQualityConfig.create",
    updateEvent: "experimentQualityConfig.update",
    deleteEvent: "experimentQualityConfig.delete",
  },
  globallyUniquePrimaryKeys: false,
});

// Named, shareable experiment quality-score configs. Referenced by id from
// org settings (`settings.experimentQuality.configId`) and project settings
// (`settings.experimentQuality.configId`).
export class ExperimentQualityConfigModel extends BaseClass {
  protected canRead(): boolean {
    // Any org member can read: configs are needed client-side to compute
    // quality scores on the Learnings page and experiment Quality tab
    return true;
  }
  protected canCreate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("experiment-quality-score");
  }
  protected async beforeDelete(existing: ExperimentQualityConfigInterface) {
    if (
      this.context.org.settings?.experimentQuality?.configId === existing.id
    ) {
      throw new Error(
        "Cannot delete this config while it is the organization default",
      );
    }
    const projects = await this.context.models.projects.getAll();
    const referencedBy = projects.find(
      (p) => p.settings?.experimentQuality?.configId === existing.id,
    );
    if (referencedBy) {
      throw new Error(
        `Cannot delete this config while the ${referencedBy.name} Project uses it`,
      );
    }
  }
}
