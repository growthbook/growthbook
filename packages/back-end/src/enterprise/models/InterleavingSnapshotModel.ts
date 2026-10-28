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
  // Callers authorize access through the parent interleaving.
  protected canRead(): boolean {
    return true;
  }

  protected override getForeignKeys(doc: InterleavingSnapshotInterface) {
    const keys = super.getForeignKeys(doc);
    const datasource = doc.frozenSettings?.datasourceId;
    return datasource ? { ...keys, datasource } : keys;
  }

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

  public listForInterleaving(
    interleavingId: string,
    limit: number = 20,
  ): Promise<InterleavingSnapshotInterface[]> {
    return this._find(
      { interleavingId },
      { sort: { dateCreated: -1 }, limit: Math.min(limit, 100) },
    );
  }

  public async getLatestSuccessfulForInterleaving(
    interleavingId: string,
  ): Promise<InterleavingSnapshotInterface | null> {
    const snapshots = await this._find(
      { interleavingId, status: "success" },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return snapshots[0] || null;
  }

  // Parent deletion has already been authorized.
  public async deleteAllForInterleaving(interleavingId: string) {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      interleavingId,
    });
  }
}
