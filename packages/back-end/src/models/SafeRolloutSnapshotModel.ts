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
}
