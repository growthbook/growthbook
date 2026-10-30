import {
  InterleavingSnapshotInterface,
  interleavingSnapshotValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: interleavingSnapshotValidator,
  collectionName: "interleavingsnapshots",
  idPrefix: "ilsnp_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        interleavingId: 1,
        dateCreated: -1,
      },
    },
  ],
});

export class InterleavingSnapshotModel extends BaseClass {
  // Snapshots have no project of their own: the parent Interleaving's current
  // project is what authorizes them, and a snapshot is only ever reached
  // through a parent already loaded via `models.interleavings`. A frozen copy
  // of the project would go stale the moment the experiment moved.
  protected canRead(): boolean {
    return true;
  }

  // The datasource id is nested in settings, so BaseModel wouldn't detect it
  // on its own.
  protected override getForeignKeys(doc: InterleavingSnapshotInterface) {
    const keys = super.getForeignKeys(doc);
    return { ...keys, datasource: doc.settings.datasourceId };
  }

  // Refreshing results is a query, not an analysis edit. canCreateExperimentSnapshot
  // is just canRunExperimentQueries, and that is what the service and the query
  // runner check, so a RunQueries-only member has to pass here too.
  private canRunQueries(doc: InterleavingSnapshotInterface): boolean {
    const { datasource } = this.getForeignRefs(doc, false);
    return (
      !!datasource &&
      this.context.permissions.canRunExperimentQueries(datasource)
    );
  }
  protected canCreate(doc: InterleavingSnapshotInterface): boolean {
    return this.canRunQueries(doc);
  }
  protected canUpdate(existing: InterleavingSnapshotInterface): boolean {
    return this.canRunQueries(existing);
  }
  protected canDelete(doc: InterleavingSnapshotInterface): boolean {
    return this.canRunQueries(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  public async getLatestForInterleaving(
    interleavingId: string,
  ): Promise<InterleavingSnapshotInterface | null> {
    const snapshots = await this._find(
      { interleavingId },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return snapshots[0] || null;
  }

  public async deleteForInterleaving(interleavingId: string): Promise<void> {
    const snapshots = await this._find({ interleavingId });
    await Promise.all(snapshots.map((snapshot) => this.delete(snapshot)));
  }

  // Capped at 100 regardless of what the caller asks for.
  public listForInterleaving(
    interleavingId: string,
    limit: number = 20,
  ): Promise<InterleavingSnapshotInterface[]> {
    return this._find(
      { interleavingId },
      { sort: { dateCreated: -1 }, limit: Math.min(limit, 100) },
    );
  }
}
