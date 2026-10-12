import {
  ExperimentQualityConfigInterface,
  ORG_DEFAULT_SCOPE,
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
// Experimentation Health settings records (`quality.configId`).
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
    const references =
      await this.context.models.experimentationHealthSettings.getByQualityConfigId(
        existing.id,
      );
    if (!references.length) return;

    if (references.some((r) => r.project === ORG_DEFAULT_SCOPE)) {
      throw new Error(
        "Cannot delete this config while the organization default uses it",
      );
    }
    const project = await this.context.models.projects.getById(
      references[0].project,
    );
    throw new Error(
      `Cannot delete this config while the ${project?.name ?? references[0].project} Project uses it`,
    );
  }
}
