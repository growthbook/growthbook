import { FilterQuery } from "mongoose";
import {
  SafeRolloutSnapshotInterface,
  safeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout-snapshot";
import { getSafeRolloutAnalysisSummary } from "back-end/src/services/safeRolloutSnapshots";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: safeRolloutSnapshotInterface,
  collectionName: "saferolloutsnapshots",
  idPrefix: "srsnp_",
  globallyUniqueIds: true,
});

export class SafeRolloutSnapshotModel extends BaseClass {
  // TODO: fix permissions
  protected canCreate() {
    return true;
  }
  protected canRead(doc: SafeRolloutSnapshotInterface) {
    const { datasource } = this.getForeignRefs(doc);

    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects
    );
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  public async getSnapshotForSafeRollout({
    safeRolloutId,
    dimension,
    beforeSnapshot,
    withResults = true,
  }: {
    safeRolloutId: string;
    dimension?: string;
    beforeSnapshot?: SafeRolloutSnapshotInterface;
    withResults?: boolean;
  }): Promise<SafeRolloutSnapshotInterface | undefined> {
    const query: FilterQuery<SafeRolloutSnapshotInterface> = {
      safeRolloutId,
      dimension: dimension || null,
    };

    const all = await super._find(
      {
        ...query,
        status: {
          $in: withResults ? ["success"] : ["success", "running", "error"],
        },
        ...(beforeSnapshot
          ? { dateCreated: { $lt: beforeSnapshot.dateCreated } }
          : {}),
      },
      {
        sort: { dateCreated: -1 },
        limit: 1,
      }
    );

    if (all[0]) {
      return all[0];
    }
  }

  public async updateById(
    id: string,
    updates: Partial<SafeRolloutSnapshotInterface>
  ) {
    const safeRolloutSnapshot = await super.updateById(id, updates);

    const latestSafeRolloutSnapshot = await this.getSnapshotForSafeRollout({
      safeRolloutId: safeRolloutSnapshot.safeRolloutId,
      withResults: false,
    });

    const isLatestSnapshot =
      latestSafeRolloutSnapshot === null ||
      latestSafeRolloutSnapshot?.id === safeRolloutSnapshot.id;

    if (isLatestSnapshot && safeRolloutSnapshot.status === "success") {
      const safeRollout = await this.context.models.safeRollout.getById(
        safeRolloutSnapshot.safeRolloutId
      );
      if (!safeRollout) {
        throw new Error("Safe rollout not found");
      }

      const safeRolloutAnalysisSummary = await getSafeRolloutAnalysisSummary({
        context: this.context,
        safeRollout,
        safeRolloutSnapshot: safeRolloutSnapshot,
      });

      await this.context.models.safeRollout.updateById(safeRollout.id, {
        analysisSummary: safeRolloutAnalysisSummary,
      });
    }

    return safeRolloutSnapshot;
  }
}
