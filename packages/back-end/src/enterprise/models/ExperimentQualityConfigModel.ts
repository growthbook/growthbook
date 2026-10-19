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
//
// Org admins can change any config. Project admins can create configs and
// change ones used only by Projects they manage, so an edit never reaches
// the organization default or someone else's Project.
export class ExperimentQualityConfigModel extends BaseClass {
  protected canRead(): boolean {
    // Any org member can read: configs are needed client-side to compute
    // quality scores on the Learnings page and experiment Quality tab
    return true;
  }
  protected canCreate(): boolean {
    return this.canManageSomeConfigs();
  }
  protected canUpdate(): boolean {
    return this.canManageSomeConfigs();
  }
  protected canDelete(): boolean {
    return this.canManageSomeConfigs();
  }
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("experiment-quality-score");
  }
  protected async beforeUpdate(existing: ExperimentQualityConfigInterface) {
    if (this.context.permissions.canManageOrgSettings()) return;
    const references =
      await this.context.models.experimentationHealthSettings.getByQualityConfigId(
        existing.id,
      );
    const allowed = references.every(
      (r) =>
        r.project !== ORG_DEFAULT_SCOPE &&
        this.context.permissions.canUpdateProject(r.project),
    );
    if (!allowed) {
      this.context.permissions.throwPermissionError(
        "This configuration is also used outside the Projects you manage. Ask an organization admin to change it, or make a copy.",
      );
    }
  }
  // Deleting is refused while anything uses the config, so it only needs
  // the base permission
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

  private canManageSomeConfigs(): boolean {
    return (
      this.context.permissions.canManageOrgSettings() ||
      this.context.permissions.canManageSomeProjects()
    );
  }
}
