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
  // Snapshot access follows the parent interleaving's project permissions;
  // reads/writes always go through code paths that loaded the parent first
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return this.context.permissions.canViewInterleavingModal();
  }
  protected canUpdate(): boolean {
    return this.canCreate();
  }
  protected canDelete(): boolean {
    return this.canCreate();
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  /** Latest snapshot for an interleaving experiment. */
  public async getLatestForInterleaving(
    interleavingId: string,
  ): Promise<InterleavingSnapshotInterface | null> {
    const snapshots = await this._find(
      { interleavingId },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return snapshots[0] || null;
  }

  /** Recent snapshots for an interleaving experiment. */
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
