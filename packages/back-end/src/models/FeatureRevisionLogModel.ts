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
