import {
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

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
  protected canCreate() {
    return true;
  }
  protected canRead() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
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
