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

  // `bypassReadPermissionChecks` grants no extra access here: `canRead()` above
  // already returns true for every snapshot, and `_find` still scopes the query
  // to the caller's organization. It is set because `_find` only pushes `limit`
  // down to Mongo when the per-document read filter is bypassed — without it
  // every snapshot for the bandit is loaded just to keep the newest one.
  // Callers remain responsible for authorizing access to the parent bandit.
  public async getLatestForContextualBandit(
    contextualBandit: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find(
      { contextualBandit },
      {
        sort: { dateCreated: -1 },
        limit: 1,
        bypassReadPermissionChecks: true,
      },
    );
    return results[0] ?? null;
  }

  // As above, plus a projection: the status poll needs only the run metadata,
  // so the large result fields are left in the database.
  public async getLatestStatusForContextualBandit(
    contextualBandit: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find(
      { contextualBandit },
      {
        sort: { dateCreated: -1 },
        limit: 1,
        bypassReadPermissionChecks: true,
        projection: { traffic: 0, frozenSettings: 0, srm: 0 },
      },
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
