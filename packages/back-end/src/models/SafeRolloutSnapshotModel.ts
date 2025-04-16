import { FilterQuery } from "mongoose";
import {
  SafeRolloutSnapshotInterface,
  safeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";
import { getSafeRolloutAnalysisSummary, notifySafeRolloutChange } from "back-end/src/services/safeRolloutSnapshots";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: safeRolloutSnapshotInterface,
  collectionName: "saferolloutsnapshots",
  idPrefix: "srsnp_",
  globallyUniqueIds: false,
});

export class SafeRolloutSnapshotModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: SafeRolloutSnapshotInterface): boolean {
    // TODO: Fix me when permission checks are implemented
    return true;
  }
  protected canRead(doc: SafeRolloutSnapshotInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);

    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects
    );
  }
  protected canUpdate(
    existing: SafeRolloutSnapshotInterface,
    updates: SafeRolloutSnapshotInterface
  ): boolean {
    // TODO: Fix me when permission checks are implemented
    return true;
  }
  protected canDelete(doc: SafeRolloutSnapshotInterface): boolean {
    // TODO: Fix me when permission checks are implemented
    return true;
  }

  public async getSnapshotForSafeRollout({
    safeRollout,
    dimension,
    beforeSnapshot,
    withResults = true,
  }: {
    safeRollout: string;
    dimension?: string;
    beforeSnapshot?: SafeRolloutSnapshotInterface;
    withResults?: boolean;
  }): Promise<SafeRolloutSnapshotInterface | undefined> {
    const query: FilterQuery<SafeRolloutSnapshotInterface> = {
      safeRolloutId: safeRollout,
      dimension: dimension || null,
    };

    // First try getting new snapshots that have a `status` field
    let all = await super._find(
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

    // Otherwise, try getting old snapshot records
    if (withResults) {
      query.results = { $exists: true, $type: "array", $ne: [] };
    }

    all = await super._find(query, {
      sort: { dateCreated: -1 },
      limit: 1,
    });

    return all[0];
  }

  public async updateById(
    id: string,
    updates: Partial<SafeRolloutSnapshotInterface>
  ) {
    const safeRolloutSnapshot = await super.updateById(id, updates);

    const latestSafeRolloutSnapshot = await this.getSnapshotForSafeRollout({
      safeRollout: safeRolloutSnapshot.safeRolloutId,
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

      await notifySafeRolloutChange({
        context: this.context,
        updatedSafeRollout: {
          ...safeRollout,
          analysisSummary: safeRolloutAnalysisSummary,
        },
        safeRolloutSnapshot
      });
    }

    return safeRolloutSnapshot;
  }
}
