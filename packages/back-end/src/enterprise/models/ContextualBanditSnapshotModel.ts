import { getAffectedEnvsForExperiment } from "shared/util";
import {
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditSnapshotValidator,
  collectionName: "contextualbanditsnapshots",
  idPrefix: "cbs_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        experiment: 1,
        phase: 1,
        dateCreated: -1,
      },
    },
    {
      fields: { contextualBanditEventId: 1 },
    },
  ],
});

export class ContextualBanditSnapshotModel extends BaseClass {
  // CBS docs are scoped to a parent experiment; delegate all RBAC to the
  // parent. Missing parent → no-access (never default-allow).
  protected canRead(doc: ContextualBanditSnapshotInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  private canWrite(doc: ContextualBanditSnapshotInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    const envs = getAffectedEnvsForExperiment({
      experiment,
      orgEnvironments: this.context.org.settings?.environments || [],
    });
    return this.context.permissions.canRunExperiment(experiment, envs);
  }

  protected canCreate(doc: ContextualBanditSnapshotInterface): boolean {
    return this.canWrite(doc);
  }
  protected canUpdate(existing: ContextualBanditSnapshotInterface): boolean {
    return this.canWrite(existing);
  }
  protected canDelete(doc: ContextualBanditSnapshotInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canDeleteExperiment(experiment);
  }

  public async getLatestForExperiment(
    experiment: string,
    phase: number,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find(
      { experiment, phase },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  public async listForExperiment(
    experiment: string,
    phase: number,
    limit = 20,
  ): Promise<ContextualBanditSnapshotInterface[]> {
    return this._find(
      { experiment, phase },
      { sort: { dateCreated: -1 }, limit },
    );
  }

  public async getBySnapshotIdInOrg(
    id: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find({ id });
    return results[0] ?? null;
  }

  public async deleteForExperiment(experiment: string): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      experiment,
    });
  }
}
