import { FilterQuery } from "mongoose";
import {
  SafeRolloutSnapshotInterface,
  safeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: safeRolloutSnapshotInterface,
  collectionName: "saferolloutsnapshots",
  idPrefix: "srsnp__",
  auditLog: {
    entity: "safeRolloutSnapshot",
    createEvent: "safeRolloutSnapshot.create",
    updateEvent: "safeRolloutSnapshot.update",
    deleteEvent: "safeRolloutSnapshot.delete",
  },
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

  public async getLatestSnapshot({
    safeRollout,
    dimension,
    beforeSnapshot,
    withResults = true,
  }: {
    safeRollout: string;
    dimension?: string;
    beforeSnapshot?: SafeRolloutSnapshotInterface;
    withResults?: boolean;
  }) {
    const query: FilterQuery<SafeRolloutSnapshotInterface> = {
      safeRolloutRuleId: safeRollout,
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
}
