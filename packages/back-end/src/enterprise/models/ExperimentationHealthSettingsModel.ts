import {
  ExperimentationHealthSettingsInterface,
  ORG_DEFAULT_SCOPE,
  experimentationHealthSettingsValidator,
} from "shared/validators";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "back-end/src/models/BaseModel";

export const EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION =
  "experimentationhealthsettings";

const BaseClass = MakeModelClass({
  schema: experimentationHealthSettingsValidator,
  collectionName: EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION,
  affectsDefinitionsVersion: true,
  idPrefix: "ehs_",
  readonlyFields: ["project"],
  auditLog: {
    entity: "experimentationHealthSettings",
    createEvent: "experimentationHealthSettings.create",
    updateEvent: "experimentationHealthSettings.update",
    deleteEvent: "experimentationHealthSettings.delete",
  },
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: { organization: 1, project: 1 },
      unique: true,
    },
  ],
});

type ScopeUpdates = Pick<ExperimentationHealthSettingsInterface, "quality">;

// One record per scope: the organization default (project "") and each
// Project that customizes anything. Fields left unset on a Project record
// inherit the organization default's value.
export class ExperimentationHealthSettingsModel extends BaseClass {
  protected canRead(): boolean {
    // Needed client-side to resolve quality scoring for every experiment
    return true;
  }
  protected canCreate(doc: ExperimentationHealthSettingsInterface): boolean {
    return this.canWriteScope(doc.project);
  }
  protected canUpdate(
    existing: ExperimentationHealthSettingsInterface,
  ): boolean {
    return this.canWriteScope(existing.project);
  }
  protected canDelete(
    existing: ExperimentationHealthSettingsInterface,
  ): boolean {
    return this.canWriteScope(existing.project);
  }
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("experiment-quality-score");
  }

  public canWriteScope(project: string): boolean {
    return project === ORG_DEFAULT_SCOPE
      ? this.context.permissions.canManageOrgSettings()
      : this.context.permissions.canUpdateProject(project);
  }

  public getForScope(
    project: string,
  ): Promise<ExperimentationHealthSettingsInterface | null> {
    return this._findOne({ project });
  }

  public async upsertForScope(
    project: string,
    updates: ScopeUpdates,
  ): Promise<ExperimentationHealthSettingsInterface> {
    // Retry once if another request creates the scope's record first
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.getForScope(project);
      if (existing) {
        return this.update(existing, updates);
      }
      try {
        return await this.create({ project, ...updates });
      } catch (e) {
        if (!isDuplicateKeyError(e)) throw e;
      }
    }
    throw new Error(
      "Could not save these settings because they are being changed somewhere else at the same time. Try again.",
    );
  }
}
