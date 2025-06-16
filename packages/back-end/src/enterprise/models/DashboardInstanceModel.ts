import mongoose from "mongoose";
import {
  dashboardInstanceInterface,
  DashboardInstanceInterface,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import {
  dashboardBlockSchema,
  toInterface as blockToInterface,
} from "./DashboardBlockModel";

export const dashboardInstanceSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organizationId: String,
  experimentId: String,
  dateCreated: Date,
  dateUpdated: Date,
  owner: String,
  title: String,
  description: String,
  blocks: [dashboardBlockSchema],
  settings: {
    baselineRow: Number,
    dateStart: Date,
    dateEnd: Date,
    defaultMetricId: String,
    defaultVariationIds: [String],
    defaultDimensionId: String,
    defaultDimensionValues: [String],
  },
});

dashboardInstanceSchema.index({
  organizationId: 1,
  experimentId: 1,
  dateCreated: -1,
});

export type DashboardInstanceDocument = mongoose.Document &
  DashboardInstanceInterface;

const BaseClass = MakeModelClass({
  schema: dashboardInstanceInterface,
  collectionName: "dashboardinstances",
  idPrefix: "dashinst_",
  auditLog: {
    entity: "dashboardInstance",
    createEvent: "dashboardInstance.create",
    updateEvent: "dashboardInstance.update",
    deleteEvent: "dashboardInstance.delete",
  },
  globallyUniqueIds: true,
});

export const toInterface: ToInterface<DashboardInstanceInterface> = (doc) => {
  const dashboard = removeMongooseFields(doc);
  dashboard.blocks = dashboard.blocks.map(blockToInterface);
  return dashboard;
};

export class DashboardInstanceModel extends BaseClass {
  protected canCreate(doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canCreateReport(experiment);
  }

  protected canRead(_doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );
    return this.context.hasPermission("readData", "");
  }

  protected canUpdate(
    existing: DashboardInstanceInterface,
    _updates: DashboardInstanceInterface
  ): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );

    const { experiment } = this.getForeignRefs(existing);
    if (!experiment) return true;
    return this.context.permissions.canUpdateReport(experiment);
  }

  protected canDelete(doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );

    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canDeleteReport(experiment);
  }

  protected migrate(doc: unknown) {
    return toInterface(doc as DashboardInstanceDocument);
  }
}
