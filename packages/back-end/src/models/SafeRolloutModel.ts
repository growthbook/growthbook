import {
  SafeRolloutInterface,
  safeRolloutValidator,
} from "back-end/src/validators/safe-rollout";
import { MakeModelClass, UpdateProps } from "./BaseModel";

export const COLLECTION_NAME = "saferollout";

const BaseClass = MakeModelClass({
  schema: safeRolloutValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "sr_",
  auditLog: {
    entity: "safeRollout",
    createEvent: "safeRollout.create",
    updateEvent: "safeRollout.update",
    deleteEvent: "safeRollout.delete",
  },
  globallyUniqueIds: true,
});

export class SafeRolloutModel extends BaseClass {
  // TODO: fix permissions
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  public async getAllByFeatureId(featureId: string) {
    return await this._find({ featureId });
  }

  protected async beforeUpdate(
    existing: SafeRolloutInterface,
    updates: UpdateProps<SafeRolloutInterface>
  ) {
    // If the Safe Rollout has already been started, we are limited on what we can update to keep the data consistent
    // If the Safe Rollout has not been started, we can update all fields
    if (existing.startedAt) {
      const allowedFieldsForUpdate = [
        "status",
        "guardrailMetricIds",
        "maxDurationDays",
        "autoSnapshots",
        "lastSnapshotAttempt",
        "nextSnapshotAttempt",
        "analysisSummary",
      ];

      // Check for disallowed field updates
      for (const [key, value] of Object.entries(updates)) {
        const typedKey = key as keyof typeof updates;

        // If the field is not allowed and is being changed
        if (
          !allowedFieldsForUpdate.includes(typedKey) &&
          existing[typedKey] !== value
        ) {
          throw new Error(
            `Cannot update field '${key}' after the Safe Rollout has started.`
          );
        }
      }
    }
  }
}
