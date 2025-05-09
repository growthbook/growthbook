import {
  GlobalHoldoutInterface,
  globalHoldoutValidator,
} from "back-end/src/validators/global-holdout";
import { MakeModelClass, UpdateProps } from "./BaseModel";

export const COLLECTION_NAME = "globalholdout";

const BaseClass = MakeModelClass({
  schema: globalHoldoutValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "gh_",
  auditLog: {
    entity: "globalHoldout" as const,
    createEvent: "globalHoldout.create" as const,
    updateEvent: "globalHoldout.update" as const,
    deleteEvent: "globalHoldout.delete" as const,
  },
  globallyUniqueIds: true,
});

export class GlobalHoldoutModel extends BaseClass {
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

  protected async beforeUpdate(
    existing: GlobalHoldoutInterface,
    updates: UpdateProps<GlobalHoldoutInterface>
  ) {
    // If the Global Holdout has already been started, we are limited on what we can update
    if (existing.startedAt) {
      const allowedFieldsForUpdate = [
        "status",
        "linkedFeatures",
        "linkedExperiments",
        "description",
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
            `Cannot update field '${key}' after the Global Holdout has started.`
          );
        }
      }
    }
  }

  async getAll(): Promise<GlobalHoldoutInterface[]> {
    return this._find({});
  }

  async addLinkedFeature(holdoutId: string, featureId: string): Promise<void> {
    const holdout = await this.getById(holdoutId);
    if (!holdout) {
      throw new Error("Global holdout not found");
    }

    if (!holdout.linkedFeatures.includes(featureId)) {
      await this.update(holdout, {
        linkedFeatures: [...holdout.linkedFeatures, featureId],
      });
    }
  }

  async removeLinkedFeature(holdoutId: string, featureId: string): Promise<void> {
    const holdout = await this.getById(holdoutId);
    if (!holdout) {
      throw new Error("Global holdout not found");
    }

    if (holdout.linkedFeatures.includes(featureId)) {
      await this.update(holdout, {
        linkedFeatures: holdout.linkedFeatures.filter((id) => id !== featureId),
      });
    }
  }
}
