import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionLogInterface,
  featureRevisionLogValidator,
} from "back-end/src/validators/feature-revision-log";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "featurerevisionlog";

const BaseClass = MakeModelClass({
  schema: featureRevisionLogValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "frl_",
  auditLog: {
    entity: "featureRevisionLog",
    createEvent: "featureRevisionLog.create",
    updateEvent: "featureRevisionLog.update",
    deleteEvent: "featureRevisionLog.delete",
  },
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        featureId: 1,
        version: 1,
      },
    },
  ],
});

export class FeatureRevisionLogModel extends BaseClass {
  protected canRead(doc: FeatureRevisionLogInterface): boolean {
    const { feature } = this.getForeignRefs(doc);

    return this.context.permissions.canReadSingleProjectResource(
      feature?.project,
    );
  }

  protected canCreate(doc: FeatureRevisionLogInterface): boolean {
    const { feature } = this.getForeignRefs(doc);
    if (!feature) {
      throw new Error("Feature not found for FeatureRevisionLog");
    }
    return (
      this.context.permissions.canCreateFeature(feature) ||
      this.context.permissions.canManageFeatureDrafts(feature)
    );
  }

  protected canUpdate(): boolean {
    // As an audit of log on the revision, we do not allow updates
    return false;
  }

  protected canDelete(): boolean {
    // As an audit of log on the revision, we do not allow deletion
    // unless the entire feature is deleted, and that check is handled
    // in the deleteAllByFeature method.
    return false;
  }

  public async getAllByFeatureIdAndVersion({
    featureId,
    version,
  }: {
    featureId: string;
    version: number;
  }) {
    return await this._find({ featureId, version });
  }

  /**
   * System bookkeeping for publish-time re-versioning of a draft revision:
   * when the revision document moves to the head of the version history its
   * log entries must follow so the draft's history stays attached. This is
   * not a user-facing update (canUpdate is intentionally false), so it writes
   * through the raw collection.
   */
  public async reassignVersion({
    featureId,
    fromVersion,
    toVersion,
  }: {
    featureId: string;
    fromVersion: number;
    toVersion: number;
  }) {
    await this._dangerousGetCollection().updateMany(
      {
        organization: this.context.org.id,
        featureId,
        version: fromVersion,
      },
      { $set: { version: toVersion } },
    );
  }

  public async deleteAllByFeature(feature: FeatureInterface) {
    // We should keep the log unless the feature itself is deleted.
    if (!this.context.permissions.canDeleteFeature(feature)) {
      throw new Error("You do not have access to delete this resource");
    }

    return await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      featureId: feature.id,
    });
  }
}
