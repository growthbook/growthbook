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
  globallyUniqueIds: true,
  additionalIndexes: [
    {
      fields: {
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
      feature?.project
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
  protected canUpdate(existing: FeatureRevisionLogInterface): boolean {
    const { feature } = this.getForeignRefs(existing);
    if (!feature) {
      throw new Error("Feature not found for FeatureRevisionLog");
    }
    return (
      this.context.permissions.canUpdateFeature(feature, {}) ||
      this.context.permissions.canManageFeatureDrafts(feature)
    );
  }

  protected canDelete(doc: FeatureRevisionLogInterface): boolean {
    const { feature } = this.getForeignRefs(doc);
    if (!feature) {
      throw new Error("Feature not found for FeatureRevisionLog");
    }
    return (
      this.context.permissions.canDeleteFeature(feature) ||
      this.context.permissions.canManageFeatureDrafts(feature)
    );
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
}
