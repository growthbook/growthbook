import { UpdateProps } from "shared/types/base-model";
import { SafeRolloutInterface, safeRolloutValidator } from "shared/validators";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import { getFeature } from "back-end/src/models/FeatureModel";
import { MakeModelClass } from "./BaseModel";

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
  defaultValues: {
    autoSnapshots: true,
  },
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
  protected migrate(
    legacyDoc: Partial<SafeRolloutInterface>,
  ): SafeRolloutInterface {
    if (!("rampUpSchedule" in legacyDoc)) {
      legacyDoc["rampUpSchedule"] = {
        enabled: false,
        step: 0,
        steps: [],
        nextUpdate: undefined,
        lastUpdate: undefined,
        rampUpCompleted: false,
      };
    }
    if (!("autoRollback" in legacyDoc)) {
      legacyDoc["autoRollback"] = false;
    }
    return legacyDoc as SafeRolloutInterface;
  }

  public async getAllByFeatureId(featureId: string) {
    return await this._find({ featureId });
  }
  public async getAllByFeatureIds(featureIds: string[]) {
    return await this._find({ featureId: { $in: featureIds } });
  }
  public async getAllPayloadSafeRollouts() {
    const safeRollouts = await this._find({});
    if (!safeRollouts || safeRollouts.length === 0) {
      return new Map();
    }
    return new Map(safeRollouts.map((r) => [r.id, r]));
  }

  protected async afterUpdate(
    existing: SafeRolloutInterface,
    updates: UpdateProps<SafeRolloutInterface>,
  ) {
    if (
      updates.rampUpSchedule &&
      existing.rampUpSchedule.step !== updates.rampUpSchedule.step
    ) {
      const feature = await getFeature(this.context, existing.featureId);
      if (!feature) return;

      queueSDKPayloadRefresh({
        context: this.context,
        payloadKeys: getAffectedSDKPayloadKeys(
          [feature],
          getEnvironmentIdsFromOrg(this.context.org),
        ),
      });
    }
  }

  protected async beforeUpdate(
    existing: SafeRolloutInterface,
    updates: UpdateProps<SafeRolloutInterface>,
  ) {
    // If the Safe Rollout has already been started, we are limited on what we can update to keep the data consistent
    // If the Safe Rollout has not been started, we can update all fields
    if (existing.startedAt) {
      const allowedFieldsForUpdate = [
        "status",
        "guardrailMetricIds",
        "maxDuration",
        "autoSnapshots",
        "lastSnapshotAttempt",
        "nextSnapshotAttempt",
        "analysisSummary",
        "pastNotifications",
        "rampUpSchedule",
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
            `Cannot update field '${key}' after the Safe Rollout has started.`,
          );
        }
      }
    }
  }
}
