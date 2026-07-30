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
        contextualBandit: 1,
        dateCreated: -1,
      },
    },
    {
      fields: { contextualBanditEventId: 1 },
    },
  ],
});

export class ContextualBanditSnapshotModel extends BaseClass {
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  public async getLatestForContextualBandit(
    contextualBandit: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find(
      { contextualBandit },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  public async listForContextualBandit(
    contextualBandit: string,
    limit?: number,
  ): Promise<ContextualBanditSnapshotInterface[]> {
    return this._find(
      { contextualBandit },
      { sort: { dateCreated: -1 }, limit },
    );
  }

  public async getBySnapshotIdInOrg(
    id: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find({ id });
    return results[0] ?? null;
  }

  public async deleteForContextualBandit(
    contextualBandit: string,
  ): Promise<void> {
    const snapshots = await this._find({ contextualBandit });
    await Promise.all(snapshots.map((snapshot) => this.delete(snapshot)));
  }
}
